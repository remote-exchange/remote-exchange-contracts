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

### veREMOTE distribution recipients

| Name | Address | Qty |
|:-----|:--------|:----|
| TBD   | TBD     | TBD |

### Neon devnet deployment

| Name        | Address                                                                                                                           |
|:------------|:----------------------------------------------------------------------------------------------------------------------------------|
| WNEON_TOKEN | [0xf8ad328e98f85fccbf09e43b16dcbbda7e84beab](https://neonscan.org/address/0xf8ad328e98f85fccbf09e43b16dcbbda7e84beab) |
| USDC_TOKEN  | [0x8A56FA4d0768c5f15C88E40D4256F41819AbaD56](https://neonscan.org/address/0x8A56FA4d0768c5f15C88E40D4256F41819AbaD56) |
| WDAI_TOKEN  | [0x583E3F2A7a2F78F0ed2bB177563C3D26769e52Ea](https://neonscan.org/address/0x583E3F2A7a2F78F0ed2bB177563C3D26769e52Ea) |
| USDT_TOKEN  | [0x5EFc3A6eD6FDA49702ffb1c65FB433387892b96d](https://neonscan.org/address/0x5EFc3A6eD6FDA49702ffb1c65FB433387892b96d)             |

| Name                 | Address                                                                                                               |
|:---------------------|:----------------------------------------------------------------------------------------------------------------------|
| RemoteFactory          | [0xE452CDC71B9f488333fa9a999B421BaC0cD988fc](https://neonscan.org/address/0xE452CDC71B9f488333fa9a999B421BaC0cD988fc) |
| RemoteRouter01         | [0x088286351671D1C50dAe1E50bA1Cb51ad62FfB65](https://neonscan.org/address/0x088286351671D1C50dAe1E50bA1Cb51ad62FfB65)                                                                                     |
| BribeFactory         | [0x8bDd46A71c4819f275e46067166dDC21676c44a7](https://neonscan.org/address/0x8bDd46A71c4819f275e46067166dDC21676c44a7)                                                                                                                      |
| GaugesFactory        | [0x848C5376aA96e00e2DF234382BEBc19ea902E75F](https://neonscan.org/address/0x848C5376aA96e00e2DF234382BEBc19ea902E75F)                                                                                                                      |
| REMOTE                 | [0x063b205706d132a016F700CA97A35c6BC9E412AE](https://neonscan.org/address/0x063b205706d132a016F700CA97A35c6BC9E412AE)                                                                             |
| RemoteMinter           | [0x3059d7762bc85a94949310e4fC4fAfe5638b9dbb](https://neonscan.org/address/0x3059d7762bc85a94949310e4fC4fAfe5638b9dbb)                                                                                                                      |
| RemoteVoter            | [0x666C9CaA4EEB36998Bc93fa156A4ad320A21CcBb](https://neonscan.org/address/0x666C9CaA4EEB36998Bc93fa156A4ad320A21CcBb)                                                                                                                      |
| veREMOTE               | [0xcA3De43EB81B8D18949B3cBd28Aaddf31214B4A6](https://neonscan.org/address/0xcA3De43EB81B8D18949B3cBd28Aaddf31214B4A6)                                                                                                                      |
| VeDist               | [0x1BE438fdEF546acdb9CFdE511F5F8F3d4a9972c9](https://neonscan.org/address/0x1BE438fdEF546acdb9CFdE511F5F8F3d4a9972c9)                                                                                                                      |
| Controller           | [0x811Ee1914CE3289c1F202E676B7500d92be8641f](https://neonscan.org/address/0x811Ee1914CE3289c1F202E676B7500d92be8641f)                                                                                                                      |

### Neon deployment

TBD
