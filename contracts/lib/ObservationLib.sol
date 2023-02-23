// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "./Math.sol";

import "hardhat/console.sol";

library ObservationLib {
    uint internal constant PERIOD_SIZE = 60 minutes;
    uint private constant MAX_VOLUME_PER_LIQUIDITY = 100000 << 64; // maximum meaningful ratio of volume to liquidity

    // Structure to capture time period obervations every 60 minutes, used for local oracles
    struct Observation {
        uint timestamp; // timestamp of the obervation - end timestamp of data window
        uint reserve0Cumulative;
        uint reserve1Cumulative;
        uint volume0Cumulative;
        uint volume1Cumulative;
        uint price0to1Cumulative;
        uint volatilityCumulative; // the volatility accumulator
        uint volumePerLiquidityCumulative;
        uint averagePrice; // average price at this timestamp
        uint lastPrice;
    }

    function _getAveragePrice(
        Observation memory oldest,
        uint lastTimestamp,
        uint lastPriceCumulative,
        uint currentPrice
    ) internal /*pure*/ view returns (uint) {
        console.log('_getAveragePrice oldest.price0to1Cumulative', oldest.price0to1Cumulative);
        console.log('_getAveragePrice lastPriceCumulative', lastPriceCumulative);
        console.log('_getAveragePrice return', oldest.price0to1Cumulative != 0 && lastPriceCumulative != 0 ? (lastPriceCumulative - oldest.price0to1Cumulative) / (lastTimestamp - oldest.timestamp) : currentPrice);
        return oldest.price0to1Cumulative != 0 && lastPriceCumulative != 0 ? (lastPriceCumulative - oldest.price0to1Cumulative) / (lastTimestamp - oldest.timestamp) : currentPrice;
    }

    function _getVolatility(
        uint delta,
        uint price0,
        uint price1,
        uint avgPrice0,
        uint avgPrice1
    ) internal pure returns (uint256 volatility) {
        // On the time interval from the previous observation to the current
        // we can represent price and average price change as two straight lines:
        // price = k*t + b, where k and b are some constants
        // avgPrice = p*t + q, where p and q are some constants
        // we want to get sum of (price(t) - avgPrice(t))^2 for every t in the interval (0; dt]
        // so: (price(t) - avgPrice(t))^2 = ((k*t + b) - (p*t + q))^2 = (k-p)^2 * t^2 + 2(k-p)(b-q)t + (b-q)^2
        // since everything except t is a constant, we need to use progressions for t and t^2:
        // sum(t) for t from 1 to dt = dt*(dt + 1)/2 = sumOfSequence
        // sum(t^2) for t from 1 to dt = dt*(dt+1)*(2dt + 1)/6 = sumOfSquares
        // so result will be: (k-p)^2 * sumOfSquares + 2(k-p)(b-q)*sumOfSequence + dt*(b-q)^2
        int dt = int(delta);
        price0 = price0 / 1e10;
        price1 = price1 / 1e10;
        avgPrice0 = avgPrice0 / 1e10;
        avgPrice1 = avgPrice1 / 1e10;
        int K = (int(price1) - int(price0)) - (int(avgPrice1) - int(avgPrice0)); // (k - p)*dt
        int B = (int(price0) - int(avgPrice0)) * dt; // (b - q)*dt
        int sumOfSquares = (dt * (dt + 1) * (2 * dt + 1)); // sumOfSquares * 6
        int sumOfSequence = (dt * (dt + 1)); // sumOfSequence * 2
        volatility = uint((K**2 * sumOfSquares + 6 * B * K * sumOfSequence + 6 * dt * B**2) / (6 * dt**2));
    }

    /// @notice Calculates gmean(volume/liquidity) for block
    /// @param liquidity The current pool liquidity
    /// @param amount0 Total amount of swapped token0
    /// @param amount1 Total amount of swapped token1
    /// @return volumePerLiquidity gmean(volume/liquidity) capped by 100000 << 64
    function _calculateVolumePerLiquidity(
        uint liquidity,
        uint amount0,
        uint amount1
    ) internal /*pure*/ view returns (uint volumePerLiquidity) {
        uint volume = Math.sqrt(amount0) * Math.sqrt(amount1);
        uint volumeShifted;
        if (volume >= 2**192) {
            volumeShifted = (type(uint).max) / (liquidity > 0 ? liquidity : 1);
        } else {
            volumeShifted = (volume << 64) / (liquidity > 0 ? liquidity : 1);
            console.log('_calculateVolumePerLiquidity volumeShifted', volumeShifted);
        }
        if (volumeShifted >= MAX_VOLUME_PER_LIQUIDITY) {
            return MAX_VOLUME_PER_LIQUIDITY;
        } else {
            return uint128(volumeShifted);
        }
    }

    function _getAverages(Observation memory latest, Observation memory prev) internal pure returns (uint volatilityAverage, uint volumePerLiqAverage) {
        if (latest.timestamp == prev.timestamp) {
            return (
                latest.volatilityCumulative / PERIOD_SIZE,
                latest.volumePerLiquidityCumulative >> 57
            );
        }
        return (
            (latest.volatilityCumulative - prev.volatilityCumulative) / (latest.timestamp - prev.timestamp),
            (latest.volumePerLiquidityCumulative - prev.volumePerLiquidityCumulative) >> 57
        );
    }
}