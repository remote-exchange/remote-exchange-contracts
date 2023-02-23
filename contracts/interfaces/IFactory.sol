// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "../lib/AdaptiveFee.sol";

interface IFactory {
  function getFeeConfig(bool stable) external view returns (AdaptiveFee.Configuration memory);
//  function feeConfigStable() external returns (uint16, uint16, uint32, uint32, uint16, uint16, uint32, uint16, uint16);
//  function feeConfigVolatile() external returns (uint16, uint16, uint32, uint32, uint16, uint16, uint32, uint16, uint16);

  function isPair(address pair) external view returns (bool);

  function getInitializable() external view returns (address, address, bool);

  function isPaused() external view returns (bool);

  function pairCodeHash() external pure returns (bytes32);

  function getPair(address tokenA, address token, bool stable) external view returns (address);

  function createPair(address tokenA, address tokenB, bool stable) external returns (address pair);
}
