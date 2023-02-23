// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "../../interfaces/IFactory.sol";
import "./RemotePair.sol";
import "../../lib/AdaptiveFee.sol";

contract RemoteFactory is IFactory {

  bool public override isPaused;
  address public pauser;
  address internal pendingPauser;

  mapping(address => mapping(address => mapping(bool => address))) public override getPair;
  address[] public allPairs;
  /// @dev Simplified check if its a pair, given that `stable` flag might not be available in peripherals
  mapping(address => bool) public override isPair;

  address internal _temp0;
  address internal _temp1;
  bool internal _temp;

  /// @dev 0.01% swap fee
  uint16 internal constant BASE_FEE_STABLE = 100;
  /// @dev 0.05% swap fee
  uint16 internal constant BASE_FEE_VOLATILE = 500;
  uint32 internal constant FEE_DENOMINATOR = 1_000_000;

  // values of constants for sigmoids in fee calculation formula
  // max fee = 0.5%
  AdaptiveFee.Configuration private _feeConfigStable = AdaptiveFee.Configuration(
    1000 - BASE_FEE_STABLE, // alpha1
    5000 - 1000, // alpha2
    360, // beta1
    60000, // beta2
    59, // gamma1
    8500, // gamma2
    0, // volumeBeta
    10, // volumeGamma
    BASE_FEE_STABLE // baseFee
  );
  // max fee = 0.5%
  AdaptiveFee.Configuration private _feeConfigVolatile = AdaptiveFee.Configuration(
    1000 - BASE_FEE_VOLATILE, // alpha1
    5000 - 1000, // alpha2
    360, // beta1
    60000, // beta2
    59, // gamma1
    8500, // gamma2
    0, // volumeBeta
    10, // volumeGamma
    BASE_FEE_VOLATILE // baseFee
  );


  event PairCreated(
    address indexed token0,
    address indexed token1,
    bool stable,
    address pair,
    uint allPairsLength
  );

  constructor() {
    pauser = msg.sender;
  }

  function getFeeConfig(bool stable) external view returns (AdaptiveFee.Configuration memory) {
    return stable ? _feeConfigStable : _feeConfigVolatile;
  }

  function allPairsLength() external view returns (uint) {
    return allPairs.length;
  }

  function setPauser(address _pauser) external {
    require(msg.sender == pauser, "RemoteFactory: Not pauser");
    pendingPauser = _pauser;
  }

  function acceptPauser() external {
    require(msg.sender == pendingPauser, "RemoteFactory: Not pending pauser");
    pauser = pendingPauser;
  }

  function setPause(bool _state) external {
    require(msg.sender == pauser, "RemoteFactory: Not pauser");
    isPaused = _state;
  }

  function setSwapFee(address pair, uint value) external {
    require(msg.sender == pauser, "RemoteFactory: Not pauser");
    RemotePair(pair).setSwapFee(value);
  }

  function toggleConcentratedPair(address pair) external {
    require(msg.sender == pauser, "RemoteFactory: Not pauser");
    RemotePair(pair).toggleConcentratedPair();
  }

  function pairCodeHash() external pure override returns (bytes32) {
    return keccak256(type(RemotePair).creationCode);
  }

  function getInitializable() external view override returns (address, address, bool) {
    return (_temp0, _temp1, _temp);
  }

  function createPair(address tokenA, address tokenB, bool stable)
  external override returns (address pair) {
    require(tokenA != tokenB, 'RemoteFactory: IDENTICAL_ADDRESSES');
    (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    require(token0 != address(0), 'RemoteFactory: ZERO_ADDRESS');
    require(getPair[token0][token1][stable] == address(0), 'RemoteFactory: PAIR_EXISTS');
    // notice salt includes stable as well, 3 parameters
    bytes32 salt = keccak256(abi.encodePacked(token0, token1, stable));
    (_temp0, _temp1, _temp) = (token0, token1, stable);
    pair = address(new RemotePair{salt : salt}());
    getPair[token0][token1][stable] = pair;
    // populate mapping in the reverse direction
    getPair[token1][token0][stable] = pair;
    allPairs.push(pair);
    isPair[pair] = true;
    emit PairCreated(token0, token1, stable, pair, allPairs.length);
  }
}
