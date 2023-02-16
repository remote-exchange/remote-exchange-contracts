// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "../../interfaces/IERC20.sol";
import "../../interfaces/IERC721Metadata.sol";
import "../../interfaces/IPair.sol";
import "../../interfaces/IFactory.sol";
import "../../interfaces/ICallee.sol";
import "../../interfaces/IUnderlying.sol";
import "./PairFees.sol";
import "../../lib/Math.sol";
import "../../lib/SafeERC20.sol";
import "../Reentrancy.sol";
import "./ConcentratedPair.sol";

import "hardhat/console.sol";

// The base pair of pools, either stable or volatile
contract RemotePair is IERC20, IPair, Reentrancy {
  using SafeERC20 for IERC20;

  string public name;
  string public symbol;
  uint8 public constant decimals = 18;

  /// @dev Used to denote stable or volatile pair
  bool public immutable stable;

  uint public override totalSupply = 0;

  mapping(address => mapping(address => uint)) public override allowance;
  mapping(address => uint) public override balanceOf;

  bytes32 internal immutable DOMAIN_SEPARATOR;
  // keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
  bytes32 internal constant PERMIT_TYPEHASH = 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;
  uint internal constant _FEE_PRECISION = 1e32;
  mapping(address => uint) public nonces;

  uint internal constant MINIMUM_LIQUIDITY = 10 ** 3;
  /// @dev 0.01% swap fee
  uint internal constant SWAP_FEE_STABLE = 10_000;
  /// @dev 0.05% swap fee
  uint internal constant SWAP_FEE_VOLATILE = 2_000;
  /// @dev 0.1% max allowed swap fee
  uint internal constant SWAP_FEE_MAX = 1_000;
  /// @dev Capture oracle reading every 60 minutes
  uint internal constant PERIOD_SIZE = 60 minutes;


  address public immutable override token0;
  address public immutable override token1;
  address public immutable fees;
  address public immutable factory;
  address public immutable concentratedPair;
  bool public concentratedPairEnabled;

  Observation[] public observations;

  uint public swapFee;
  uint internal immutable decimals0;
  uint internal immutable decimals1;

  uint public reserve0;
  uint public reserve1;
  uint public blockTimestampLast;

  uint internal reserve0CumulativeLast;
  uint internal reserve1CumulativeLast;
  uint internal price0to1Cumulative;
  uint internal volume0Cumulative;
  uint internal volume1Cumulative;
  uint public override lastPrice0to1;

  // index0 and index1 are used to accumulate fees,
  // this is split out from normal trades to keep the swap "clean"
  // this further allows LP holders to easily claim fees for tokens they have/staked
  uint internal index0 = 0;
  uint internal index1 = 0;

  // position assigned to each LP to track their current index0 & index1 vs the global position
  mapping(address => uint) public supplyIndex0;
  mapping(address => uint) public supplyIndex1;

  // tracks the amount of unclaimed, but claimable tokens off of fees for token0 and token1
  mapping(address => uint) public claimable0;
  mapping(address => uint) public claimable1;

  event Treasury(address indexed sender, uint amount0, uint amount1);
  event Fees(address indexed sender, uint amount0, uint amount1);
  event Mint(address indexed sender, uint amount0, uint amount1);
  event Burn(address indexed sender, uint amount0, uint amount1, address indexed to);
  event Swap(
    address indexed sender,
    uint amount0In,
    uint amount1In,
    uint amount0Out,
    uint amount1Out,
    address indexed to
  );
  event Sync(uint reserve0, uint reserve1);
  event Claim(address indexed sender, address indexed recipient, uint amount0, uint amount1);
  event FeesChanged(uint newValue);

  constructor() {
    factory = msg.sender;
    (address _token0, address _token1, bool _stable) = IFactory(msg.sender).getInitializable();
    (token0, token1, stable) = (_token0, _token1, _stable);
    fees = address(new PairFees(_token0, _token1));

    swapFee = _stable ? SWAP_FEE_STABLE : SWAP_FEE_VOLATILE;

    if (_stable) {
      name = string(abi.encodePacked("StableV1 AMM - ", IERC721Metadata(_token0).symbol(), "/", IERC721Metadata(_token1).symbol()));
      symbol = string(abi.encodePacked("sAMM-", IERC721Metadata(_token0).symbol(), "/", IERC721Metadata(_token1).symbol()));
    } else {
      name = string(abi.encodePacked("VolatileV1 AMM - ", IERC721Metadata(_token0).symbol(), "/", IERC721Metadata(_token1).symbol()));
      symbol = string(abi.encodePacked("vAMM-", IERC721Metadata(_token0).symbol(), "/", IERC721Metadata(_token1).symbol()));
    }

    decimals0 = 10 ** IUnderlying(_token0).decimals();
    decimals1 = 10 ** IUnderlying(_token1).decimals();

    observations.push(Observation(block.timestamp, 0, 0, 0, 0, 0));

    DOMAIN_SEPARATOR = keccak256(
      abi.encode(
        keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
        keccak256(bytes(name)),
        keccak256('1'),
        block.chainid,
        address(this)
      )
    );

    address _concentratedPair = address(new ConcentratedPair(_token0, _token1));
    concentratedPair = _concentratedPair;
    IERC20(_token0).safeIncreaseAllowance(concentratedPair, type(uint).max);
    IERC20(_token1).safeIncreaseAllowance(concentratedPair, type(uint).max);

    concentratedPairEnabled = true;
  }

  function setSwapFee(uint value) external {
    require(msg.sender == factory, "!factory");
    require(value >= SWAP_FEE_MAX, "max");
    swapFee = value;
    emit FeesChanged(value);
  }

  function observationLength() external view returns (uint) {
    return observations.length;
  }

  function tokens() external view override returns (address, address) {
    return (token0, token1);
  }

  /// @dev Claim accumulated but unclaimed fees (viewable via claimable0 and claimable1)
  function claimFees() external override returns (uint claimed0, uint claimed1) {
    _updateFor(msg.sender);

    claimed0 = claimable0[msg.sender];
    claimed1 = claimable1[msg.sender];

    if (claimed0 > 0 || claimed1 > 0) {
      claimable0[msg.sender] = 0;
      claimable1[msg.sender] = 0;

      PairFees(fees).claimFeesFor(msg.sender, claimed0, claimed1);

      emit Claim(msg.sender, msg.sender, claimed0, claimed1);
    }
  }

  /// @dev Accrue fees on token
  function _updateFees(uint amount, bool isToken0) internal {
    address token = isToken0 ? token0 : token1;
    // transfer the fees out to PairFees
    IERC20(token).safeTransfer(fees, amount);
    // 1e32 adjustment is removed during claim
    uint _ratio = amount * _FEE_PRECISION / totalSupply;
    if (_ratio > 0) {
      if (isToken0) {
        index0 += _ratio;
      } else {
        index1 += _ratio;
      }
    }
    emit Fees(msg.sender, isToken0 ? amount : 0, isToken0 ? 0 : amount);
  }

  /// @dev This function MUST be called on any balance changes,
  ///      otherwise can be used to infinitely claim fees
  //       Fees are segregated from core funds, so fees can never put liquidity at risk
  function _updateFor(address recipient) internal {
    uint _supplied = balanceOf[recipient];
    // get LP balance of `recipient`
    if (_supplied > 0) {
      uint _supplyIndex0 = supplyIndex0[recipient];
      // get last adjusted index0 for recipient
      uint _supplyIndex1 = supplyIndex1[recipient];
      uint _index0 = index0;
      // get global index0 for accumulated fees
      uint _index1 = index1;
      supplyIndex0[recipient] = _index0;
      // update user current position to global position
      supplyIndex1[recipient] = _index1;
      uint _delta0 = _index0 - _supplyIndex0;
      // see if there is any difference that need to be accrued
      uint _delta1 = _index1 - _supplyIndex1;
      if (_delta0 > 0) {
        uint _share = _supplied * _delta0 / _FEE_PRECISION;
        // add accrued difference for each supplied token
        claimable0[recipient] += _share;
      }
      if (_delta1 > 0) {
        uint _share = _supplied * _delta1 / _FEE_PRECISION;
        claimable1[recipient] += _share;
      }
    } else {
      supplyIndex0[recipient] = index0;
      // new users are set to the default global state
      supplyIndex1[recipient] = index1;
    }
  }

  function getReserves() external view override returns (
    uint112 _reserve0,
    uint112 _reserve1,
    uint32 _blockTimestampLast
  ) {
    _reserve0 = uint112(reserve0);
    _reserve1 = uint112(reserve1);
    _blockTimestampLast = uint32(blockTimestampLast);
  }

  function cPairRatio() public view returns (uint) {
        return swapFee / 10;
//    return 0;
  }

  function _rebalanceConcentratedPair(uint balance0, uint balance1) internal {
    uint _cPairRatio = cPairRatio();
    if (_cPairRatio != 0) {

      uint desired0 = balance0 / _cPairRatio;
      uint desired1 = balance1 / _cPairRatio;
      address _concentratedPair = concentratedPair;
      uint cBalance0 = IERC20(token0).balanceOf(_concentratedPair);
      uint cBalance1 = IERC20(token1).balanceOf(_concentratedPair);

      console.log('desired0', desired0);
      console.log('desired1', desired1);
      console.log('cBalance0', cBalance0);
      console.log('cBalance1', cBalance1);

      if (cBalance0 < desired0 / 100) {
        uint toSwap1 = cBalance1 > desired1 ? cBalance1 - desired1 : cBalance1 / 2;
        console.log('>>> REBALANCE0');
        console.log('toSwap1', toSwap1);
        IERC20(token1).safeTransferFrom(_concentratedPair, address(this), toSwap1);
        (uint swapped, uint b0, uint b1) = _internalSwap(
          toSwap1,
          false,
          _concentratedPair,
          balance0,
          balance1
        );

        console.log('swapped', swapped);
        cBalance0 += swapped;
        if (desired0 > cBalance0) {
          uint need0 = desired0 - cBalance0;
          uint ratio = need0 * 1e18 / b0;
          uint need1 = b1 * ratio / 1e18;
          console.log('need0', need0);
          console.log('need1', need1);

          IERC20(token0).safeTransfer(_concentratedPair, need0);
          IERC20(token1).safeTransfer(_concentratedPair, need1);
          b0 -= need0;
          b1 -= need1;
        }
        reserve0 = b0;
        reserve1 = b1;

        ConcentratedPair(_concentratedPair).setPrice(lastPrice0to1);
      } else if (cBalance1 < desired1 / 100) {

        uint toSwap0 = cBalance0 > desired0 ? cBalance0 - desired0 : cBalance0 / 2;
        console.log('>>> REBALANCE1');
        console.log('toSwap0', toSwap0);
        IERC20(token0).safeTransferFrom(_concentratedPair, address(this), toSwap0);
        (uint swapped, uint b0, uint b1) = _internalSwap(
          toSwap0,
          true,
          _concentratedPair,
          balance0,
          balance1
        );

        console.log('swapped', swapped);
        cBalance1 += swapped;
        if (desired1 > cBalance1) {
          uint need1 = desired1 - cBalance1;
          uint ratio = need1 * 1e18 / b1;
          uint need0 = b0 * ratio / 1e18;
          console.log('need0', need0);
          console.log('need1', need1);

          IERC20(token0).safeTransfer(_concentratedPair, need0);
          IERC20(token1).safeTransfer(_concentratedPair, need1);
          b0 -= need0;
          b1 -= need1;
        }
        reserve0 = b0;
        reserve1 = b1;

        ConcentratedPair(_concentratedPair).setPrice(lastPrice0to1);
      }
      // both lower or higher not suppose to be. if yes - just handle as usual, should be balanced in next calls

      console.log('cBalance0 after', IERC20(token0).balanceOf(_concentratedPair));
      console.log('cBalance1 after', IERC20(token1).balanceOf(_concentratedPair));
//      console.log('VIRTUAL price after', _amountsToPrice0to1(IERC20(token0).balanceOf(address(this)), 0, 0, IERC20(token1).balanceOf(address(this))));
    }
  }

  function _reservesRatio(uint balance0, uint balance1, uint price) internal view returns (uint) {
    console.log('price', price);
    console.log('BALANCE0', balance0);
    console.log('BALANCE1', balance1);
    uint b0 = balance0 * price / decimals0;
    uint b1 = balance1 * 1e18 / decimals1;
    console.log('b0', b0);
    console.log('b1', b1);
    return b0 * 1e18 / b1;
  }

  function _internalSwap(
    uint amountIn,
    bool isTokenIn0,
    address to,
    uint _reserve0,
    uint _reserve1
  ) internal returns (
    uint amountOut,
    uint balance0,
    uint balance1
  ) {
    uint reserveOut = isTokenIn0 ? _reserve1 : _reserve0;
    address tokenIn = isTokenIn0 ? token0 : token1;
    address tokenOut = isTokenIn0 ? token1 : token0;
    if (amountIn > 0) {
      amountOut = _getAmountOut(amountIn, tokenIn, _reserve0, _reserve1);
      require(amountOut > 0 && amountOut < reserveOut, "!input");

      IERC20(tokenOut).safeTransfer(to, amountOut);
    }

    balance0 = IERC20(token0).balanceOf(address(this));
    balance1 = IERC20(token1).balanceOf(address(this));
    // The curve, either x3y+y3x for stable pools, or x*y for volatile pools
    console.log('INTERNAL k old', _k(_reserve0, _reserve1));
    console.log('INTERNAL k new', _k(balance0, balance1));
    require(_k(balance0, balance1) + 1 >= _k(_reserve0, _reserve1), "K");
  }

  function _amountsToPrice0to1(
    uint amount0Out,
    uint amount1Out,
    uint amount0In,
    uint amount1In
  ) internal view returns (uint) {
    console.log('------ _amountsToPrice0to1');
    console.log('amount0Out', amount0Out);
    console.log('amount1Out', amount1Out);
    console.log('amount0In', amount0In);
    console.log('amount1In', amount1In);
    if (amount0Out != 0 && amount1In != 0) {
      console.log('price1', (amount0Out * 1e18 / decimals0) * 1e18 / (amount1In * 1e18 / decimals1));
      return (amount0Out * 1e18 / decimals0) * 1e18 / (amount1In * 1e18 / decimals1);
    } else if (amount1Out != 0 && amount0In != 0) {
      console.log('price0', (amount0In * 1e18 / decimals0) * 1e18 / (amount1Out * 1e18 / decimals1));
      return (amount0In * 1e18 / decimals0) * 1e18 / (amount1Out * 1e18 / decimals1);
    }
    return 0;
  }

  function getLastAveragePrice0to1() public view returns (uint) {
    uint timeElapsed = blockTimestampLast - observations[observations.length - 1].timestamp;
    return price0to1Cumulative / timeElapsed;
  }

  /// @dev Update reserves and, on the first call per block, price accumulators
  function _update(
    uint balance0,
    uint balance1,
    uint _reserve0,
    uint _reserve1,
    uint amount0Out,
    uint amount1Out,
    uint amount0In,
    uint amount1In
  ) internal {
    Observation memory point = observations[observations.length - 1];
    uint timeElapsed = block.timestamp - blockTimestampLast;

    uint _price0to1 = _amountsToPrice0to1(
      amount0Out,
      amount1Out,
      amount0In,
      amount1In
    );
    uint _volume0 = amount0In + amount0Out;
    uint _volume1 = amount1In + amount1Out;

    if (_price0to1 != 0 && concentratedPairEnabled) {
      // potential vuln: this price can be manipulated by increasing amountOut
      // todo fix
      lastPrice0to1 = _price0to1;
      console.log('_update new lastPrice0to1', lastPrice0to1);
//      ConcentratedPair(concentratedPair).setPrice(_price0to1);
    }

    // overflow is desired
  unchecked {
    if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
      if (_price0to1 != 0) price0to1Cumulative += _price0to1 * timeElapsed;
      reserve0CumulativeLast += _reserve0 * timeElapsed;
      reserve1CumulativeLast += _reserve1 * timeElapsed;
    }

    if (_volume0 != 0) volume0Cumulative += _volume0;
    if (_volume1 != 0) volume1Cumulative += _volume1;
  }
    timeElapsed = block.timestamp - point.timestamp;
    // compare the last observation with current timestamp,
    // if greater than 60 minutes, record a new event
    if (timeElapsed > PERIOD_SIZE) {
      observations.push(Observation({
      timestamp : block.timestamp,
      reserve0Cumulative : reserve0CumulativeLast,
      reserve1Cumulative : reserve1CumulativeLast,
      price0to1Cumulative : price0to1Cumulative,
      volume0Cumulative : volume0Cumulative,
      volume1Cumulative : volume1Cumulative
      }));
      delete volume0Cumulative;
      delete volume1Cumulative;
    }

    reserve0 = balance0;
    reserve1 = balance1;
    blockTimestampLast = block.timestamp;
    emit Sync(reserve0, reserve1);
  }

  /// @dev This low-level function should be called from a contract which performs important safety checks
  function mint(address to) external lock override returns (uint liquidity) {
    (address _token0, address _token1) = (token0, token1);
    (uint _reserve0, uint _reserve1) = (reserve0, reserve1);
    address cPair = concentratedPair;
    uint cBalance0 = IERC20(_token0).balanceOf(cPair);
    uint cBalance1 = IERC20(_token1).balanceOf(cPair);
    uint _balance0 = IERC20(_token0).balanceOf(address(this));
    uint _balance1 = IERC20(_token1).balanceOf(address(this));
    uint _amount0 = _balance0 - _reserve0;
    uint _amount1 = _balance1 - _reserve1;

    uint _totalSupply = totalSupply;
    // gas savings, must be defined here since totalSupply can update in _mintFee
    if (_totalSupply == 0) {
      liquidity = Math.sqrt(_amount0 * _amount1) - MINIMUM_LIQUIDITY;
      // permanently lock the first MINIMUM_LIQUIDITY tokens
      _mint(address(0), MINIMUM_LIQUIDITY);
    } else {
      liquidity = Math.min(_amount0 * _totalSupply / (_reserve0 + cBalance0), _amount1 * _totalSupply / (_reserve1 + cBalance1));
    }
    require(liquidity > 0, 'RemotePair: INSUFFICIENT_LIQUIDITY_MINTED');
    _mint(to, liquidity);

    if (_totalSupply > 0 && concentratedPairEnabled) {
      uint _cRatio = cPairRatio();
      if (_cRatio != 0) {
        IERC20(_token0).safeTransfer(cPair, _amount0 / _cRatio);
        IERC20(_token1).safeTransfer(cPair, _amount1 / _cRatio);
        _balance0 -= (_amount0 / _cRatio);
        _balance1 -= (_amount1 / _cRatio);
      }
    }
    _update(_balance0, _balance1, _reserve0, _reserve1, 0, 0, 0, 0);
    emit Mint(msg.sender, _amount0, _amount1);
  } 

  /// @dev This low-level function should be called from a contract which performs important safety checks
  ///      standard uniswap v2 implementation
  function burn(address to) external lock override returns (uint amount0, uint amount1) {
    (address _token0, address _token1) = (token0, token1);
    (uint _reserve0, uint _reserve1) = (reserve0, reserve1);
    address cPair = concentratedPair;
    uint cBalance0 = IERC20(_token0).balanceOf(cPair);
    uint cBalance1 = IERC20(_token1).balanceOf(cPair);
    uint _balance0 = IERC20(_token0).balanceOf(address(this));
    uint _balance1 = IERC20(_token1).balanceOf(address(this));
    uint _liquidity = balanceOf[address(this)];

    // gas savings, must be defined here since totalSupply can update in _mintFee
    uint _totalSupply = totalSupply;
    // using balances ensures pro-rata distribution
    amount0 = _liquidity * (_balance0 + cBalance0) / _totalSupply;
    // using balances ensures pro-rata distribution
    amount1 = _liquidity * (_balance1 + cBalance1) / _totalSupply;
    require(amount0 > 0 && amount1 > 0, 'RemotePair: INSUFFICIENT_LIQUIDITY_BURNED');
    _burn(address(this), _liquidity);

    _transferReserve(_token0, to, amount0, _balance0, cBalance0, cPair);
    _transferReserve(_token1, to, amount1, _balance1, cBalance1, cPair);

    _balance0 = IERC20(_token0).balanceOf(address(this));
    _balance1 = IERC20(_token1).balanceOf(address(this));

    _update(_balance0, _balance1, _reserve0, _reserve1, 0, 0, 0, 0);
    emit Burn(msg.sender, amount0, amount1, to);
  }

  function _transferReserve(address token, address to, uint amount, uint localBalance, uint cBalance, address cPair) internal {
    uint ratio = cBalance * 1e18 / (localBalance + cBalance);
    uint cAmount = amount * ratio / 1e18;
    uint lAmount = amount - cAmount;
    IERC20(token).safeTransfer(to, lAmount);
    IERC20(token).safeTransferFrom(cPair, to, cAmount);
  }

  struct SwapContext {
    uint reserve0;
    uint reserve1;
    uint balance0;
    uint balance1;
    uint cAmount0In;
    uint cAmount1In;
    uint amount0OutRemaining;
    uint amount1OutRemaining;
    address token0;
    address token1;
    uint cK;
  }

  /// @dev This low-level function should be called from a contract which performs important safety checks
  function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external override lock {
    require(!IFactory(factory).isPaused(), "RemotePair: PAUSE");
    require(amount0Out > 0 || amount1Out > 0, 'RemotePair: INSUFFICIENT_OUTPUT_AMOUNT');


    console.log('amount0Out', amount0Out);
    console.log('amount1Out', amount1Out);

    SwapContext memory context = new SwapContext[](1)[0];
    context.reserve0 = reserve0;
    context.reserve1 = reserve1;
    context.token0 = token0;
    context.token1 = token1;

    require(to != context.token0 && to != context.token1, 'RemotePair: INVALID_TO');

    address cPair = concentratedPair;

    console.log('cBal 0', IERC20(context.token0).balanceOf(cPair));
    console.log('cBal 1', IERC20(context.token1).balanceOf(cPair));

    (
    context.cAmount0In,
    context.cAmount1In,
    context.amount0OutRemaining,
    context.amount1OutRemaining,
    context.cK
    ) = ConcentratedPair(cPair).getAmountIn(amount0Out, amount1Out);

    require(context.amount0OutRemaining < context.reserve0 && context.amount1OutRemaining < context.reserve1, 'RemotePair: INSUFFICIENT_LIQUIDITY');

    // optimistically transfer tokens from concentrated pair
    if (amount0Out - context.amount0OutRemaining > 0) {
      IERC20(context.token0).safeTransferFrom(cPair, to, amount0Out - context.amount0OutRemaining);
    }
    if (amount1Out - context.amount1OutRemaining > 0) {
      IERC20(context.token1).safeTransferFrom(cPair, to, amount1Out - context.amount1OutRemaining);
    }

    // optimistically transfer tokens from this contract
    if (context.amount0OutRemaining > 0) IERC20(context.token0).safeTransfer(to, context.amount0OutRemaining);
    if (context.amount1OutRemaining > 0) IERC20(context.token1).safeTransfer(to, context.amount1OutRemaining);

    // callback, used for flash loans
    if (data.length > 0) ICallee(to).hook(msg.sender, amount0Out, amount1Out, data);

    console.log('context.reserve0', context.reserve0);
    console.log('context.reserve1', context.reserve1);
    console.log('context.cAmount0In', context.cAmount0In);
    console.log('context.cAmount1In', context.cAmount1In);
    console.log('context.cK', context.cK);
    console.log('context.amount0OutRemaining', context.amount0OutRemaining);
    console.log('context.amount1OutRemaining', context.amount1OutRemaining);

    context.balance0 = IERC20(context.token0).balanceOf(address(this));
    context.balance1 = IERC20(context.token1).balanceOf(address(this));

    console.log('context.balance0', context.balance0);
    console.log('context.balance1', context.balance1);

    uint amount0In = context.balance0 >= context.reserve0 - context.amount0OutRemaining ? context.balance0 - (context.reserve0 - context.amount0OutRemaining) : 0;
    uint amount1In = context.balance1 >= context.reserve1 - context.amount1OutRemaining ? context.balance1 - (context.reserve1 - context.amount1OutRemaining) : 0;

    console.log('amount0In pure', amount0In);
    console.log('amount1In pure', amount1In);

    require(amount0In > 0 || amount1In > 0, 'RemotePair: INSUFFICIENT_INPUT_AMOUNT');

    // transfer input token to concentrated pair
    if (context.cAmount0In > 0) IERC20(context.token0).safeTransfer(cPair, context.cAmount0In);
    if (context.cAmount1In > 0) IERC20(context.token1).safeTransfer(cPair, context.cAmount1In);
    context.balance0 -= context.cAmount0In;
    context.balance1 -= context.cAmount1In;

    // accrue fees for tokens and move them out of pool
    if (amount0In > 0) _updateFees(amount0In / swapFee, true);
    if (amount1In > 0) _updateFees(amount1In / swapFee, false);
    context.balance0 -= amount0In / swapFee;
    context.balance1 -= amount1In / swapFee;

    // The curve, either x3y+y3x for stable pools, or x*y for volatile pools
    require(_k(context.balance0, context.balance1) >= _k(context.reserve0, context.reserve1), 'RemotePair: K');
    console.log('cK', ConcentratedPair(cPair).k());
    console.log('cBal 0', IERC20(context.token0).balanceOf(cPair));
    console.log('cBal 1', IERC20(context.token1).balanceOf(cPair));
    // check concentrated pair invariant, should be the same or higher
    require(ConcentratedPair(cPair).k() >= context.cK, 'RemotePair: cK');

    console.log('bal0 after K', IERC20(context.token0).balanceOf(address(this)));
    console.log('bal1 after K', IERC20(context.token1).balanceOf(address(this)));

    _update(context.balance0, context.balance1, context.reserve0, context.reserve1, amount0Out, amount1Out, amount0In, amount1In);
    if (concentratedPairEnabled) {
      _rebalanceConcentratedPair(context.balance0, context.balance1);
    }
    emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);

    console.log('bal0 END', IERC20(context.token0).balanceOf(address(this)));
    console.log('bal1 END', IERC20(context.token1).balanceOf(address(this)));
  }

  /// @dev Force balances to match reserves
  function skim(address to) external lock {
    (address _token0, address _token1) = (token0, token1);
    IERC20(_token0).safeTransfer(to, IERC20(_token0).balanceOf(address(this)) - (reserve0));
    IERC20(_token1).safeTransfer(to, IERC20(_token1).balanceOf(address(this)) - (reserve1));
  }

  // force reserves to match balances
  function sync() external lock {
    if (lastPrice0to1 != 0) {
      _rebalanceConcentratedPair(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }
    _update(
      IERC20(token0).balanceOf(address(this)),
      IERC20(token1).balanceOf(address(this)),
      reserve0,
      reserve1, 0, 0, 0, 0
    );
  }

  function _f(uint x0, uint y) internal pure returns (uint) {
    return x0 * (y * y / 1e18 * y / 1e18) / 1e18 + (x0 * x0 / 1e18 * x0 / 1e18) * y / 1e18;
  }

  function _d(uint x0, uint y) internal pure returns (uint) {
    return 3 * x0 * (y * y / 1e18) / 1e18 + (x0 * x0 / 1e18 * x0 / 1e18);
  }

  function _getY(uint x0, uint xy, uint y) internal pure returns (uint) {
    for (uint i = 0; i < 255; i++) {
      uint yPrev = y;
      uint k = _f(x0, y);
      if (k < xy) {
        uint dy = (xy - k) * 1e18 / _d(x0, y);
        y = y + dy;
      } else {
        uint dy = (k - xy) * 1e18 / _d(x0, y);
        y = y - dy;
      }
      if (Math.closeTo(y, yPrev, 1)) {
        break;
      }
    }
    return y;
  }

  function getAmountOut(uint amountIn, address tokenIn) external view override returns (uint) {
    // remove fee from amount received
    amountIn -= Math.ceilDiv(amountIn, swapFee);

    uint amountOut;
    uint amountInRemaining;
    ConcentratedPair cPair = ConcentratedPair(concentratedPair);
    if (cPair.k() > 0 && concentratedPairEnabled) {
      (
      amountOut,
      amountInRemaining
      ) = ConcentratedPair(concentratedPair).getAmountOut(amountIn, tokenIn);
    } else {
      amountInRemaining = amountIn;
    }

    console.log('getAmountOut amountIn', amountIn);
    console.log('getAmountOut amountInRemaining', amountInRemaining);

    if (amountInRemaining != 0) {
      (uint _reserve0, uint _reserve1) = (reserve0, reserve1);
      amountOut += _getAmountOut(amountInRemaining, tokenIn, _reserve0, _reserve1);
    }
    return amountOut;
  }

  function _getAmountOut(uint amountIn, address tokenIn, uint _reserve0, uint _reserve1) internal view returns (uint) {
    if (stable) {
      uint xy = _k(_reserve0, _reserve1);
      _reserve0 = _reserve0 * 1e18 / decimals0;
      _reserve1 = _reserve1 * 1e18 / decimals1;
      (uint reserveA, uint reserveB) = tokenIn == token0 ? (_reserve0, _reserve1) : (_reserve1, _reserve0);
      amountIn = tokenIn == token0 ? amountIn * 1e18 / decimals0 : amountIn * 1e18 / decimals1;
      uint y = reserveB - _getY(amountIn + reserveA, xy, reserveB);
      return y * (tokenIn == token0 ? decimals1 : decimals0) / 1e18;
    } else {
      (uint reserveA, uint reserveB) = tokenIn == token0 ? (_reserve0, _reserve1) : (_reserve1, _reserve0);
      return amountIn * reserveB / (reserveA + amountIn);
    }
  }

  function _k(uint x, uint y) internal view returns (uint) {
    if (stable) {
      uint _x = x * 1e18 / decimals0;
      uint _y = y * 1e18 / decimals1;
      uint _a = (_x * _y) / 1e18;
      uint _b = ((_x * _x) / 1e18 + (_y * _y) / 1e18);
      // x3y+y3x >= k
      return _a * _b / 1e18;
    } else {
      // xy >= k
      return x * y;
    }
  }

  //****************************************************************************
  //**************************** ERC20 *****************************************
  //****************************************************************************

  function _mint(address dst, uint amount) internal {
    // balances must be updated on mint/burn/transfer
    _updateFor(dst);
    totalSupply += amount;
    balanceOf[dst] += amount;
    emit Transfer(address(0), dst, amount);
  }

  function _burn(address dst, uint amount) internal {
    _updateFor(dst);
    totalSupply -= amount;
    balanceOf[dst] -= amount;
    emit Transfer(dst, address(0), amount);
  }

  function approve(address spender, uint amount) external override returns (bool) {
    require(spender != address(0), "RemotePair: Approve to the zero address");
    allowance[msg.sender][spender] = amount;

    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function permit(
    address owner,
    address spender,
    uint value,
    uint deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external override {
    require(deadline >= block.timestamp, 'RemotePair: EXPIRED');
    bytes32 digest = keccak256(
      abi.encodePacked(
        '\x19\x01',
        DOMAIN_SEPARATOR,
        keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
      )
    );
    address recoveredAddress = ecrecover(digest, v, r, s);
    require(recoveredAddress != address(0) && recoveredAddress == owner, 'RemotePair: INVALID_SIGNATURE');
    allowance[owner][spender] = value;

    emit Approval(owner, spender, value);
  }

  function transfer(address dst, uint amount) external override returns (bool) {
    _transferTokens(msg.sender, dst, amount);
    return true;
  }

  function transferFrom(address src, address dst, uint amount) external override returns (bool) {
    address spender = msg.sender;
    uint spenderAllowance = allowance[src][spender];

    if (spender != src && spenderAllowance != type(uint).max) {
      require(spenderAllowance >= amount, "RemotePair: Insufficient allowance");
    unchecked {
      uint newAllowance = spenderAllowance - amount;
      allowance[src][spender] = newAllowance;
      emit Approval(src, spender, newAllowance);
    }
    }

    _transferTokens(src, dst, amount);
    return true;
  }

  function _transferTokens(address src, address dst, uint amount) internal {
    require(dst != address(0), "RemotePair: Transfer to the zero address");

    // update fee position for src
    _updateFor(src);
    // update fee position for dst
    _updateFor(dst);

    uint srcBalance = balanceOf[src];
    require(srcBalance >= amount, "RemotePair: Transfer amount exceeds balance");
  unchecked {
    balanceOf[src] = srcBalance - amount;
  }

    balanceOf[dst] += amount;

    emit Transfer(src, dst, amount);
  }

  function toggleConcentratedPair() external {
    require(msg.sender == factory, "!factory");
    if (concentratedPairEnabled) {
      IERC20(token0).safeTransferFrom(concentratedPair, address(this), IERC20(token0).balanceOf(concentratedPair));
      IERC20(token1).safeTransferFrom(concentratedPair, address(this), IERC20(token1).balanceOf(concentratedPair));
      _update(
        IERC20(token0).balanceOf(address(this)),
        IERC20(token1).balanceOf(address(this)),
        reserve0,
        reserve1, 0, 0, 0, 0
      );
      lastPrice0to1 = 0;
      ConcentratedPair(concentratedPair).setPrice(0);
      concentratedPairEnabled = false;
    } else {
      concentratedPairEnabled = true;
    }
  }
}
