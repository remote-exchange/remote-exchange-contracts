// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "../interfaces/IRouter.sol";
import "../interfaces/IFactory.sol";
import "../interfaces/IPair.sol";
import "../interfaces/IUnderlying.sol";
import "../lib/Math.sol";

contract SwapLibrary {

  address  immutable public factory;
  IRouter immutable public router;
  bytes32 immutable pairCodeHash;

  constructor(address _router) {
    router = IRouter(_router);
    factory = IRouter(_router).factory();
    pairCodeHash = IFactory(IRouter(_router).factory()).pairCodeHash();
  }

  function getNormalizedReserves(address tokenA, address tokenB, bool stable) external view returns (uint reserveA, uint reserveB){
    address pair = pairFor(tokenA, tokenB, stable);
    if (pair == address(0)) {
      return (0, 0);
    }
    (uint reserve0, uint reserve1,) = IPair(pair).getReserves();
    address t0 = IPair(pair).token0();
    address t1 = IPair(pair).token1();

    uint decimals0 = IUnderlying(t0).decimals();
    uint decimals1 = IUnderlying(t1).decimals();

    reserveA = tokenA == t0 ? reserve0 : reserve1;
    reserveB = tokenA == t0 ? reserve1 : reserve0;
    uint decimalsA = tokenA == t0 ? decimals0 : decimals1;
    uint decimalsB = tokenA == t0 ? decimals1 : decimals0;
    reserveA = reserveA * 1e18 / decimalsA;
    reserveB = reserveB * 1e18 / decimalsB;
  }

  function getTradeDiff(uint amountIn, address tokenIn, address tokenOut, bool stable) external view returns (uint a, uint b) {
    return getTradeDiffForPair(amountIn, tokenIn, pairFor(tokenIn, tokenOut, stable));
  }

  function getTradeDiffForPair(uint amountIn, address tokenIn, address pair) public view returns (uint a, uint b) {
    uint price = IPair(pair).lastPrice0to1();
    address token0 = IPair(pair).token0();
    a = tokenIn == token0 ? amountIn * price / 1e18 : amountIn * 1e18 / price;
    b = IPair(pair).getAmountOut(amountIn, tokenIn);
  }

  /// @dev Calculates the CREATE2 address for a pair without making any external calls.
  function pairFor(address tokenA, address tokenB, bool stable) public view returns (address pair) {
    (address token0, address token1) = sortTokens(tokenA, tokenB);
    pair = address(uint160(uint(keccak256(abi.encodePacked(
        hex'ff',
        factory,
        keccak256(abi.encodePacked(token0, token1, stable)),
        pairCodeHash // init code hash
      )))));
  }

  function sortTokens(address tokenA, address tokenB) public pure returns (address token0, address token1) {
    require(tokenA != tokenB, 'IDENTICAL_ADDRESSES');
    (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    require(token0 != address(0), 'ZERO_ADDRESS');
  }

}
