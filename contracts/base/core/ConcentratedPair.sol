// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "../../interfaces/IUnderlying.sol";
import "../../lib/SafeERC20.sol";
import "../../lib/Math.sol";

import "hardhat/console.sol";

contract ConcentratedPair {
  using SafeERC20 for IERC20;

  /// @dev The pair it is bonded to
  address public immutable pair;
  /// @dev Token0 of pair, saved localy and statically for gas optimization
  address public immutable token0;
  /// @dev Token1 of pair, saved localy and statically for gas optimization
  address public immutable token1;

  uint internal immutable decimals0;
  uint internal immutable decimals1;

  uint public price;

  event PriceChanged(uint price);

  constructor(address _token0, address _token1) {
    pair = msg.sender;
    token0 = _token0;
    token1 = _token1;
    decimals0 = 10 ** IUnderlying(_token0).decimals();
    decimals1 = 10 ** IUnderlying(_token1).decimals();

    IERC20(_token0).safeIncreaseAllowance(msg.sender, type(uint).max);
    IERC20(_token1).safeIncreaseAllowance(msg.sender, type(uint).max);
  }

  modifier onlyPair() {
    require(msg.sender == pair, "!pair");
    _;
  }

  function setPrice(uint _price) external onlyPair {
//    require(_price != 0, "zero price");
    price = _price;
    emit PriceChanged(_price);
  }

  function getAmountOut(uint amountIn, address tokenIn) external view returns (
    uint amountOut,
    uint amountInRemaining
  ){
    address _token0 = token0;
    address _token1 = token1;
    uint _decimals0 = decimals0;
    uint _decimals1 = decimals1;
    uint _price = price;

    if (tokenIn == _token0) {
      uint amountInAdj = amountIn * 1e18 / _decimals0;
      amountOut = amountInAdj * 1e18 / _price * _decimals1 / 1e18;
    } else {
      uint amountInAdj = amountIn * 1e18 / _decimals1;
      amountOut = amountInAdj * _price / 1e18 * _decimals0 / 1e18;
    }

    uint reserveOut = tokenIn == _token0 ? IERC20(_token1).balanceOf(address(this)) : IERC20(_token0).balanceOf(address(this));
    amountInRemaining = 0;
    if (amountOut > reserveOut) {
      uint diff = amountOut - reserveOut;
      amountOut = reserveOut;
      if (tokenIn == _token0) {
        amountInRemaining = diff * 1e18 / _decimals1 * _price / 1e18 * _decimals0 / 1e18;
      } else {
        amountInRemaining = diff * 1e18 / _decimals0 * 1e18 / _price * _decimals1 / 1e18;
      }
    }
  }

  function getAmountIn(uint amount0Out, uint amount1Out) external view returns (
    uint amountIn0,
    uint amountIn1,
    uint amount0OutRemaining,
    uint amount1OutRemaining,
    uint cK
  ) {
    uint _price = price;

    uint reserve1 = IERC20(token1).balanceOf(address(this));
    amount1OutRemaining = amount1Out > reserve1 ? amount1Out - reserve1 : 0;
    amountIn0 = Math.ceilDiv((amount1Out - amount1OutRemaining) * 1e18 / decimals1 * _price, 1e18) * decimals0 / 1e18;

    uint reserve0 = IERC20(token0).balanceOf(address(this));
    amount0OutRemaining = amount0Out > reserve0 ? amount0Out - reserve0 : 0;
    amountIn1 = Math.ceilDiv((amount0Out - amount0OutRemaining) * 1e18 / decimals0 * 1e18, _price) * decimals1 / 1e18;

    cK = _k(reserve0, reserve1, _price);
  }

  function k() public view returns (uint) {
    return _k(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)), price);
  }

  function _k(uint reserve0, uint reserve1, uint _price) internal view returns (uint) {
    console.log('reserve0', reserve0);
    console.log('reserve1', reserve1);
    console.log('reserve0 priced', _price != 0 ? reserve0 * _price / decimals0 : 0);
    console.log('reserve1 priced', _price != 0 ? reserve1 * 1e18 / _price * 1e18 / decimals1 : 0);
    return _price != 0 ? reserve0 * 1e18 / decimals0 + reserve1 * _price / decimals1 : 0;
  }
}
