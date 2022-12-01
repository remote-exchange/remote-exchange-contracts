## Remote exchange

[![codecov](https://codecov.io/gh/remote-exchange/remote-exchange-contracts/branch/master/graph/badge.svg?token=U94WAFLRT7)](https://codecov.io/gh/remote-exchange/remote-exchange-contracts)

Remote allows low cost, near 0 slippage trades on uncorrelated or tightly correlated assets. The protocol incentivizes
fees instead of liquidity. Liquidity providers (LPs) are given incentives in the form of `token`, the amount received is
calculated as follows;

* 100% of weekly distribution weighted on votes from ve-token holders

The above is distributed to the `gauge` (see below), however LPs will earn between 40% and 100% based on their own
ve-token balance.

LPs with 0 ve* balance, will earn a maximum of 40%.

## AMM

What differentiates Remote's AMM;

Remote AMMs are compatible with all the standard features as popularized by Uniswap V2, these include;

* Lazy LP management
* Fungible LP positions
* Chained swaps to route between pairs
* priceCumulativeLast that can be used as external TWAP
* Flashloan proof TWAP
* Direct LP rewards via `skim`
* xy>=k

Remote adds on the following features;

* 0 upkeep 30 minute TWAPs. This means no additional upkeep is required, you can quote directly from the pair
* Fee split. Fees do not auto accrue, this allows external protocols to be able to profit from the fee claim
* New curve: x3y+y3x, which allows efficient stable swaps
* Curve
  quoting: `y = (sqrt((27 a^3 b x^2 + 27 a b^3 x^2)^2 + 108 x^12) + 27 a^3 b x^2 + 27 a b^3 x^2)^(1/3)/(3 2^(1/3) x) - (2^(1/3) x^3)/(sqrt((27 a^3 b x^2 + 27 a b^3 x^2)^2 + 108 x^12) + 27 a^3 b x^2 + 27 a b^3 x^2)^(1/3)`
* Routing through both stable and volatile pairs
* Flashloan proof reserve quoting

## token

**TBD**

## ve-token

Vested Escrow (ve), this is the core voting mechanism of the system, used by `RemoteFactory` for gauge rewards and gauge
voting.

This is based off of ve(3,3)

* `deposit_for` deposits on behalf of
* `emit Transfer` to allow compatibility with third party explorers
* balance is moved to `tokenId` instead of `address`
* Locks are unique as NFTs, and not on a per `address` basis

```
function balanceOfNFT(uint) external returns (uint)
```

## RemotePair

RemotePair is the base pair, referred to as a `pool`, it holds two (2) closely correlated assets (example MIM-UST) if a
stable pool or two (2) uncorrelated assets (example FTM-SPELL) if not a stable pool, it uses the standard UniswapV2Pair
interface for UI & analytics compatibility.

```
function mint(address to) external returns (uint liquidity)
function burn(address to) external returns (uint amount0, uint amount1)
function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external
```

Functions should not be referenced directly, should be interacted with via the RemoteRouter

Fees are not accrued in the base pair themselves, but are transfered to `PairFees` which has a 1:1 relationship
with `RemotePair`

### RemoteFactory

RemoteFactory allows for the creation of `pools`
via ```function createPair(address tokenA, address tokenB, bool stable) external returns (address pair)```

RemoteFactory uses an immutable pattern to create pairs, further reducing the gas costs involved in swaps

Anyone can create a pool permissionlessly.

### RemoteRouter

RemoteRouter is a wrapper contract and the default entry point into Stable V1 pools.

```

function addLiquidity(
    address tokenA,
    address tokenB,
    bool stable,
    uint amountADesired,
    uint amountBDesired,
    uint amountAMin,
    uint amountBMin,
    address to,
    uint deadline
) external ensure(deadline) returns (uint amountA, uint amountB, uint liquidity)

function removeLiquidity(
    address tokenA,
    address tokenB,
    bool stable,
    uint liquidity,
    uint amountAMin,
    uint amountBMin,
    address to,
    uint deadline
) public ensure(deadline) returns (uint amountA, uint amountB)

function swapExactTokensForTokens(
    uint amountIn,
    uint amountOutMin,
    route[] calldata routes,
    address to,
    uint deadline
) external ensure(deadline) returns (uint[] memory amounts)

```

## Gauge

Gauges distribute arbitrary `token(s)` rewards to RemotePair LPs based on voting weights as defined by `ve` voters.

Arbitrary rewards can be added permissionlessly
via ```function notifyRewardAmount(address token, uint amount) external```

Gauges are completely overhauled to separate reward calculations from deposit and withdraw. This further protect LP
while allowing for infinite token calculations.

Previous iterations would track rewardPerToken as a shift everytime either totalSupply, rewardRate, or time changed.
Instead we track each individually as a checkpoint and then iterate and calculation.

## Bribe

Gauge bribes are natively supported by the protocol, Bribes inherit from Gauges and are automatically adjusted on votes.

Users that voted can claim their bribes via calling ```function getReward(address token) public```

Fees accrued by `Gauges` are distributed to `Bribes`

### BaseV1Voter

Gauge factory permissionlessly creates gauges for `pools` created by `RemoteFactory`. Further it handles voting for 100%
of the incentives to `pools`.

```
function vote(address[] calldata _poolVote, uint[] calldata _weights) external
function distribute(address token) external
```

### Referral program

When you create an NFT, you can set another NFT id as a referral if you set the referral ID you will have:

- +10% to your boost in a gauge but no more than x2.5

However, for this bonus, you will send a part of your profit (3%) to the referral.
If a user did not set the referral id, everything as usual. 

Also, an NFT for referral should have at least 1% of the current circulation supply at the moment of referral setup.

### veREMOTE distribution recipients

| Name | Address | Qty |
|:-----|:--------|:----|
| TBD   | TBD     | TBD |

### Goerli deployment

| Name       | Address                                                                                                                           |
|:-----------|:----------------------------------------------------------------------------------------------------------------------------------|
| WETH | [0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6](https://goerli.etherscan.io/address/0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6) |
| USDC | [0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C](https://goerli.etherscan.io/address/0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C) |
| DAI  | [0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60](https://goerli.etherscan.io/address/0xdc31ee1784292379fbb2964b3b9c4124d8f89c60) |

| Name                 | Address                                                                                                               |
|:---------------------|:----------------------------------------------------------------------------------------------------------------------|
| RemoteFactory          | [0xcA3De43EB81B8D18949B3cBd28Aaddf31214B4A6](https://goerli.etherscan.io/address/0xcA3De43EB81B8D18949B3cBd28Aaddf31214B4A6) |
| RemoteRouter01         | [0x848C5376aA96e00e2DF234382BEBc19ea902E75F](https://goerli.etherscan.io/address/0x848C5376aA96e00e2DF234382BEBc19ea902E75F)                                                                                     |
| BribeFactory         | [0xBEC703542f6A728eCF64fb166bfDdd5f4C66842B](https://goerli.etherscan.io/address/0xBEC703542f6A728eCF64fb166bfDdd5f4C66842B)                                                                                                                      |
| GaugesFactory        | [0x55E7267B5F1a617363cFb1A0E8d8976676A4Fe34](https://goerli.etherscan.io/address/0x55E7267B5F1a617363cFb1A0E8d8976676A4Fe34)                                                                                                                      |
| REMOTE                 | [0x1BE438fdEF546acdb9CFdE511F5F8F3d4a9972c9](https://goerli.etherscan.io/address/0x1BE438fdEF546acdb9CFdE511F5F8F3d4a9972c9)                                                                             |
| RemoteMinter           | [0x6f99991C5994888dE61E575422526C2618CFEbFD](https://goerli.etherscan.io/address/0x6f99991C5994888dE61E575422526C2618CFEbFD)                                                                                                                      |
| RemoteVoter            | [0xb3ad2C4229B38eF53E9FDB51358136f9FE039eb1](https://goerli.etherscan.io/address/0xb3ad2C4229B38eF53E9FDB51358136f9FE039eb1)                                                                                                                      |
| veREMOTE               | [0x3059d7762bc85a94949310e4fC4fAfe5638b9dbb](https://goerli.etherscan.io/address/0x3059d7762bc85a94949310e4fC4fAfe5638b9dbb)                                                                                                                      |
| VeDist               | [0xA85A93493661BDF1a8607e0f58Fcbc537e93a16a](https://goerli.etherscan.io/address/0xA85A93493661BDF1a8607e0f58Fcbc537e93a16a)                                                                                                                      |
| Controller           | [0x8bDd46A71c4819f275e46067166dDC21676c44a7](https://goerli.etherscan.io/address/0x8bDd46A71c4819f275e46067166dDC21676c44a7)                                                                                                                      |
