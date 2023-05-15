import {
  ContractTestHelper,
  RemoteFactory,
  RemotePair,
  RemoteRouter01,
  IERC20__factory,
  Token,
  ConcentratedPair, ConcentratedPair__factory,
} from '../../../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import chai from 'chai';
import { Deploy } from '../../../scripts/deploy/Deploy';
import { TimeUtils } from '../../TimeUtils';
import { TestHelper } from '../../TestHelper';
import { BigNumber, utils } from 'ethers';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { Misc } from '../../../scripts/Misc';
import { appendFileSync, writeFileSync } from 'fs';

const { expect } = chai;

describe('pair tests', function() {

  let snapshotBefore: string;
  let snapshot: string;

  let owner: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let factory: RemoteFactory;
  let router: RemoteRouter01;
  let testHelper: ContractTestHelper;

  let ust: Token;
  let mim: Token;
  let dai: Token;
  let wmatic: Token;

  let pair: RemotePair;
  let pair2: RemotePair;

  const MAX_GAS_MINT = 220_000; // 180_000
  const MAX_GAS_BURN = 160_000;
  const MAX_GAS_SWAP = 500_000; // 400_000

  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    [owner, owner2, owner3] = await ethers.getSigners();
    wmatic = await Deploy.deployContract(owner, 'Token', 'WMATIC', 'WMATIC', 18, owner.address) as Token;
    await wmatic.mint(owner.address, parseUnits('10000'));
    factory = await Deploy.deployRemoteFactory(owner);
    router = await Deploy.deployRemoteRouter01(owner, factory.address, wmatic.address);

    [ust, mim, dai] = await TestHelper.createMockTokensAndMint(owner);
    await ust.transfer(owner2.address, utils.parseUnits('10000000000', 6));
    await mim.transfer(owner2.address, utils.parseUnits('10000000000'));
    await dai.transfer(owner2.address, utils.parseUnits('10000000000'));

    pair = await TestHelper.addLiquidity(
      factory,
      router,
      owner,
      mim.address,
      ust.address,
      utils.parseUnits('1'),
      utils.parseUnits('1', 6),
      true,
    );
    pair2 = await TestHelper.addLiquidity(
      factory,
      router,
      owner,
      mim.address,
      wmatic.address,
      utils.parseUnits('1'),
      utils.parseUnits('1'),
      true,
    );
    testHelper = await Deploy.deployContract(owner, 'ContractTestHelper') as ContractTestHelper;
  });

  after(async function() {
    await TimeUtils.rollback(snapshotBefore);
  });

  beforeEach(async function() {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function() {
    await TimeUtils.rollback(snapshot);
  });

  it('observationLength test', async function() {
    expect(await pair.observationLength()).is.eq(1);
  });

  it('burn test', async function() {
    await pair.approve(router.address, parseUnits('10000'));
    await router.removeLiquidity(
      mim.address,
      ust.address,
      true,
      await pair.balanceOf(owner.address),
      0,
      0,
      owner.address,
      999999999999,
    );
    expect(await pair.balanceOf(owner.address)).is.eq(0);
  });

  it('skim test', async function() {
    const balA = await mim.balanceOf(pair.address);
    const balB = await ust.balanceOf(pair.address);
    await mim.transfer(pair.address, parseUnits('0.001'));
    await ust.transfer(pair.address, parseUnits('0.001', 6));
    await pair.skim(owner.address);
    expect(await mim.balanceOf(pair.address)).is.eq(balA);
    expect(await ust.balanceOf(pair.address)).is.eq(balB);
  });

  it('sync test', async function() {
    await mim.transfer(pair.address, parseUnits('0.001'));
    await ust.transfer(pair.address, parseUnits('0.001', 6));
    await pair.sync();
    expect(await pair.reserve0()).is.not.eq(0);
    expect(await pair.reserve1()).is.not.eq(0);
  });

  it('very little swap', async function() {
    await mim.approve(router.address, parseUnits('1'));
    await wmatic.approve(router.address, parseUnits('1'));
    await router.swapExactTokensForTokens(4, BigNumber.from(0), [
      {
        from: mim.address,
        to: wmatic.address,
        stable: true,
      },
    ], owner.address, 9999999999);
    await router.swapExactTokensForTokens(2, BigNumber.from(0), [
      {
        to: mim.address,
        from: wmatic.address,
        stable: true,
      },
    ], owner.address, 9999999999);
  });

  it('insufficient liquidity minted revert', async function() {
    await expect(pair2.mint(owner.address)).revertedWith('RemotePair: INSUFFICIENT_LIQUIDITY_MINTED');
  });

  it('insufficient liquidity burned revert', async function() {
    await expect(pair2.burn(owner.address)).revertedWith('RemotePair: INSUFFICIENT_LIQUIDITY_BURNED');
  });

  it('swap on pause test', async function() {
    await factory.setPause(true);
    await expect(pair2.swap(1, 1, owner.address, '0x')).revertedWith('RemotePair: PAUSE');
  });

  it('insufficient output amount', async function() {
    await expect(pair2.swap(0, 0, owner.address, '0x')).revertedWith('RemotePair: INSUFFICIENT_OUTPUT_AMOUNT');
  });

  it('insufficient liquidity', async function() {
    await expect(pair2.swap(Misc.MAX_UINT, Misc.MAX_UINT, owner.address, '0x'))
      .revertedWith('RemotePair: INSUFFICIENT_LIQUIDITY');
  });

  it('invalid to', async function() {
    await expect(pair2.swap(1, 1, wmatic.address, '0x')).revertedWith('RemotePair: INVALID_TO');
  });

  it('flash swap', async function() {
    const amount = parseUnits('0.1');
    // send fees + a bit more for covering a gap. it will be sent back after the swap
    await mim.transfer(pair2.address, amount.div(1950));
    await wmatic.transfer(pair2.address, amount.div(1950));
    const r = await pair.getReserves();
    await pair2.swap(
      amount,
      amount,
      testHelper.address,
      ethers.utils.defaultAbiCoder.encode(['address'], [pair2.address]),
    );
    const r0 = await pair.getReserves();
    expect(r[0]).eq(r0[0]);
    expect(r[1]).eq(r0[1]);
  });

  it('reentrancy should revert', async function() {
    await expect(pair2.swap(
      10000,
      10000,
      ust.address,
      ethers.utils.defaultAbiCoder.encode(['address'], [pair2.address]),
    )).revertedWith('Reentrant call');
  });

  it('insufficient input amount', async function() {
    await expect(pair2.swap(parseUnits('0.001').add(10000000), parseUnits('0.001').add(1000000), owner.address, '0x'))
      .revertedWith('RemotePair: INSUFFICIENT_INPUT_AMOUNT');
  });

  it('k revert', async function() {
    await mim.transfer(pair2.address, 1);
    await expect(pair2.swap(10000000, 1000000, owner.address, '0x')).revertedWith('RemotePair: K');
  });

  it('approve with zero adr revert', async function() {
    await expect(pair2.approve(Misc.ZERO_ADDRESS, 1)).revertedWith('RemotePair: Approve to the zero address');
  });

  it('permit expire', async function() {
    const {
      v,
      r,
      s,
    } = await TestHelper.permitForPair(
      owner,
      pair2,
      pair2.address,
      parseUnits('1'),
      '1',
    );
    await expect(pair2.permit(owner.address, pair2.address, parseUnits('1'), '1', v, r, s)).revertedWith('RemotePair: EXPIRED');
  });

  it('permit invalid signature', async function() {
    const {
      v,
      r,
      s,
    } = await TestHelper.permitForPair(
      owner,
      pair2,
      pair2.address,
      parseUnits('1'),
      '999999999999',
    );
    await expect(pair2.permit(pair2.address, pair2.address, parseUnits('1'), '999999999999', v, r, s))
      .revertedWith('RemotePair: INVALID_SIGNATURE');
  });

  it('transfer to himself without approve', async function() {
    await pair2.transferFrom(owner.address, owner.address, 1);
  });

  it('transfer without allowence revert', async function() {
    await expect(pair2.transferFrom(owner2.address, owner.address, 1)).revertedWith('RemotePair: Insufficient allowance');
  });

  it('transfer to zero address should be reverted', async function() {
    await expect(pair2.transferFrom(owner.address, Misc.ZERO_ADDRESS, 1)).revertedWith('RemotePair: Transfer to the zero address');
  });

  it('transfer exceed balance', async function() {
    await expect(pair2.transfer(owner.address, parseUnits('999999'))).revertedWith('RemotePair: Transfer amount exceeds balance');
  });

  it('getAmountOut loop test', async function() {
    await prices(owner, factory, router, true);
  });

  it('set fees test', async function() {
    await factory.setSwapFee(pair.address, 100_000);
    expect(await pair.swapFee()).eq(100_000);
  });

  it('set fees revert too high', async function() {
    await expect(factory.setSwapFee(pair.address, 999)).revertedWith('max');
  });

  it('set fees revert not factory', async function() {
    await expect(pair.setSwapFee(1000)).revertedWith('!factory');
  });

  it('compare 1 trade with multiple trades test', async function() {
    const loop1 = await swapInLoop(owner, factory, router, 1);
    const loop100 = await swapInLoop(owner, factory, router, 10);
    expect(+formatUnits(loop100.sub(loop1))).is.approximately(-5e-6, 1e-6,
      'difference should be not huge',
    );
  });

  it('swap gas', async function() {
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    await IERC20__factory.connect(token0, owner).transfer(pair.address, 1000000);
    await IERC20__factory.connect(token1, owner).transfer(pair.address, 1000000);
    const tx = await pair.swap(0, 10, owner.address, '0x');
    const receipt = await tx.wait();
    expect(receipt.gasUsed).is.below(BigNumber.from(MAX_GAS_SWAP));
  });

  it('price without impact', async function() {
    const p = await TestHelper.addLiquidity(
      factory,
      router,
      owner,
      mim.address,
      dai.address,
      utils.parseUnits('1000000000'),
      utils.parseUnits('2000000000'),
      true,
    );

    // const priceMim = await p.priceWithoutImpact(mim.address)
    // console.log('PRICE MIM', priceMim.toString(), formatUnits(priceMim));
    const priceMimImp = await p.getAmountOut(parseUnits('1'), mim.address);
    console.log('PRICE MIM imp', formatUnits(priceMimImp));
    // const priceDai = await p.priceWithoutImpact(dai.address)
    // console.log('PRICE DAI', priceDai.toString(), formatUnits(priceDai));
    const priceDaiImp = await p.getAmountOut(parseUnits('1'), dai.address);
    console.log('PRICE DAI imp', formatUnits(priceDaiImp));

    const reserves = await p.getReserves();
    console.log('price0', getStablePrice(+formatUnits(reserves[0]), +formatUnits(reserves[1])));
    console.log('price1', getStablePrice(+formatUnits(reserves[1]), +formatUnits(reserves[0])));

    const balance = await dai.balanceOf(owner.address);
    await mim.transfer(p.address, parseUnits('1'));
    const out = await p.getAmountOut(parseUnits('1'), mim.address);
    await p.swap(0, out, owner.address, '0x');
    console.log('TRADE pure:', formatUnits((await dai.balanceOf(owner.address)).sub(balance)), formatUnits(out));
    expect(await dai.balanceOf(owner.address)).eq(balance.add(out));

    await mim.transfer(p.address, parseUnits('1'));
    await expect(p.swap(0, (await p.getAmountOut(parseUnits('1'), mim.address)).add(1), owner.address, '0x'))
      .revertedWith('RemotePair: K');
    // should normally swap without extra dust
    await p.swap(0, (await p.getAmountOut(parseUnits('1'), mim.address)), owner.address, '0x');
  });

  it('mint gas', async function() {
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    await IERC20__factory.connect(token0, owner).transfer(pair.address, 100000000);
    await IERC20__factory.connect(token1, owner).transfer(pair.address, 100000000);
    const tx = await pair.mint(owner.address);
    const receipt = await tx.wait();
    expect(receipt.gasUsed).below(BigNumber.from(MAX_GAS_MINT));
  });

  it('burn gas', async function() {
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    await IERC20__factory.connect(token0, owner).transfer(pair.address, 100000000);
    await IERC20__factory.connect(token1, owner).transfer(pair.address, 100000000);
    await pair.mint(owner.address);
    await IERC20__factory.connect(pair.address, owner).transfer(pair.address, 100000000);
    const tx = await pair.burn(owner.address);
    const receipt = await tx.wait();
    expect(receipt.gasUsed).below(BigNumber.from(MAX_GAS_BURN));
  });

  it('lastPrice0to1 test', async function() {
    const token0 = await pair2.token0();
    const token1 = await pair2.token1();
    const price = await pair2.lastPrice0to1();
    const amountIn = parseUnits('0.00001');
    const amountOut = await pair2.getAmountOut(amountIn, token0);
    const amountPrice = +formatUnits(amountIn) / +formatUnits(amountOut);
    console.log('PRICE', formatUnits(price));
    console.log('amountOut', formatUnits(amountOut));
    console.log('amount price', amountPrice);

    const swapAmount = parseUnits('0.1');
    await IERC20__factory.connect(token1, owner).transfer(pair2.address, swapAmount);
    await pair2.swap(await pair2.getAmountOut(swapAmount, token0), 0, owner.address, '0x');

    const price2 = await pair2.lastPrice0to1();
    const amountIn2 = parseUnits('0.00001');
    const amountOut2 = await pair2.getAmountOut(amountIn2, token0);
    const amountPrice2 = +formatUnits(amountIn2) / +formatUnits(amountOut2);

    console.log('PRICE2', formatUnits(price2));
    console.log('amountOut2', formatUnits(amountOut2));
    console.log('amount price2', amountPrice2);

    expect(amountPrice2).approximately(+formatUnits(price2), 0.001);
  });

  it('lastPrice0to1 init test', async function() {
    // init price of stable pool with equal reserves must be close to 1.0
    expect(+formatUnits(await pair.lastPrice0to1())).approximately(1.0, 0.000001);
    expect(+formatUnits(await pair2.lastPrice0to1())).approximately(1.0, 0.000001);

    const p = await TestHelper.addLiquidity(
        factory,
        router,
        owner,
        mim.address,
        dai.address,
        utils.parseUnits('1000000'),
        utils.parseUnits('2000000'),
        true,
    );
    const cPair = ConcentratedPair__factory.connect(await p.concentratedPair(), owner)

    const price0 = await p.lastPrice0to1()
    expect(await cPair.price()).eq(price0)

    // buy token0
    const swapAmount = utils.parseUnits('2')
    const amountOut0 = await p.getAmountOut(swapAmount, await p.token1());
    await IERC20__factory.connect(await p.token1(), owner).transfer(p.address, swapAmount);
    await p.swap(amountOut0, 0, owner.address, '0x');

    const priceAfterSwap0 = await p.lastPrice0to1()

    // sell token0
    await IERC20__factory.connect(await p.token0(), owner).transfer(p.address, swapAmount);
    const amountOut1 = await p.getAmountOut(swapAmount, await p.token0())
    await p.swap(0, amountOut1, owner.address, '0x');

    const priceAfterSwap1 = await p.lastPrice0to1();

    expect(+formatUnits(amountOut0) / +formatUnits(swapAmount)).approximately(+formatUnits(price0), 0.0001);
    expect(+formatUnits(swapAmount) / +formatUnits(amountOut1)).approximately(+formatUnits(price0), 0.0001);

    console.log('Init price            ', price0.toString())
    console.log('Price after buy token0', priceAfterSwap0.toString())
    console.log('Price after buy token1', priceAfterSwap1.toString())
  });

  it('disable/enable cPair', async function() {
    // make first swap in pair
    const swapAmount = utils.parseUnits('0.1', 6)
    await IERC20__factory.connect(await pair2.token1(), owner).transfer(pair2.address, swapAmount);
    await pair2.swap(await pair2.getAmountOut(swapAmount, await pair2.token1()), 0, owner.address, '0x');

    const cPair = await pair2.concentratedPair();
    const t0 = IERC20__factory.connect(await pair2.token0(), owner);
    const t1 = IERC20__factory.connect(await pair2.token1(), owner);
    expect(await t0.balanceOf(cPair)).gt(0);
    expect(await t1.balanceOf(cPair)).gt(0);

    await expect(pair2.toggleConcentratedPair()).to.revertedWith('!factory')
    await factory.toggleConcentratedPair(pair2.address);

    expect(await pair2.concentratedPairEnabled()).eq(false)
    expect(await t0.balanceOf(cPair)).eq(0);
    expect(await t1.balanceOf(cPair)).eq(0);
    expect(await pair2.lastPrice0to1()).eq(0)
    expect(await ConcentratedPair__factory.connect(cPair, owner).price()).eq(0)

    await IERC20__factory.connect(await pair2.token1(), owner).transfer(pair2.address, swapAmount);
    await pair2.swap(await pair2.getAmountOut(swapAmount, await pair2.token1()), 0, owner.address, '0x');

    expect(await pair2.concentratedPairEnabled()).eq(false)
    expect(await t0.balanceOf(cPair)).eq(0);
    expect(await t1.balanceOf(cPair)).eq(0);
    expect(await pair2.lastPrice0to1()).eq(0)
    expect(await ConcentratedPair__factory.connect(cPair, owner).price()).eq(0)

    await factory.toggleConcentratedPair(pair2.address);
    expect(await pair2.concentratedPairEnabled()).eq(true)
    await IERC20__factory.connect(await pair2.token1(), owner).transfer(pair2.address, swapAmount);
    await pair2.swap(await pair2.getAmountOut(swapAmount, await pair2.token1()), 0, owner.address, '0x');
    expect(await t0.balanceOf(cPair)).gt(0);
    expect(await t1.balanceOf(cPair)).gt(0);
    expect(await pair2.lastPrice0to1()).gt(0)
  });

  it('small liquidity invariant test', async function() {
    const p = await TestHelper.addLiquidity(
        factory,
        router,
        owner,
        mim.address,
        ust.address,
        utils.parseUnits('0.3'),
        utils.parseUnits('1', 6),
        true,
    );

    const swapAmount = utils.parseUnits('0.1', 6)
    await IERC20__factory.connect(await p.token1(), owner).transfer(p.address, swapAmount);
    await p.swap(await p.getAmountOut(swapAmount, await p.token1()), 0, owner.address, '0x');
  });

  it('rebalance cPair price impact test', async function() {
    const forPriceAmount = utils.parseUnits('1');
    const swapAmount = parseUnits('400');

    const pair3 = await TestHelper.addLiquidity(
        factory,
        router,
        owner,
        wmatic.address,
        mim.address,
        utils.parseUnits('1000'),
        utils.parseUnits('1000'),
        true,
    );
    const cPair = await ConcentratedPair__factory.connect(await pair3.concentratedPair(), owner);
    expect(await pair3.concentratedPairEnabled()).eq(true);

    const beforeSwapCPairPrice = await cPair.price();
    const beforeSwapPairPrice = await pair3.getAmountOut(forPriceAmount, mim.address);

    const wmaticAmount = await wmatic.balanceOf(owner.address);
    const mimAmount = await mim.balanceOf(owner.address);

    await mim.approve(router.address, swapAmount);
    await router.swapExactTokensForTokensSimple(
        swapAmount,
        0,
        mim.address,
        wmatic.address,
        true,
        owner.address,
        99999999999,
    );

    const wmaticAfterSwap0Amount = await wmatic.balanceOf(owner.address);
    const mimAfterSwap0Amount = await mim.balanceOf(owner.address);
    const wmatic0Diff = wmaticAfterSwap0Amount - wmaticAmount;
    const mim0Diff = mimAmount - mimAfterSwap0Amount;
    console.log('diff wmatic ', wmatic0Diff);
    console.log('diff mim '   , mim0Diff);

    const afterSwap0CPairPrice = await cPair.price();
    const afterSwap0PairPrice = await pair3.getAmountOut(forPriceAmount, mim.address);
    expect(afterSwap0CPairPrice > beforeSwapCPairPrice).eq(true);
    expect(afterSwap0PairPrice < beforeSwapPairPrice).eq(true);

    await mim.approve(router.address, swapAmount);
    await router.swapExactTokensForTokensSimple(
        swapAmount,
        0,
        mim.address,
        wmatic.address,
        true,
        owner.address,
        99999999999,
    );

    const wmaticAfterSwap1Amount = await wmatic.balanceOf(owner.address);
    const mimAfterSwap1Amount = await mim.balanceOf(owner.address);
    const wmatic1Diff = wmaticAfterSwap1Amount - wmaticAfterSwap0Amount;
    const mim1Diff = mimAfterSwap0Amount - mimAfterSwap1Amount;
    console.log('diff wmatic ', wmatic1Diff);
    console.log('diff mim '   , mim1Diff);

    const afterSwap1CPairPrice = await cPair.price();
    const afterSwap1PairPrice = await pair3.getAmountOut(forPriceAmount, mim.address);
    expect(afterSwap1CPairPrice > afterSwap0CPairPrice).eq(true);
    expect(afterSwap1PairPrice < afterSwap0PairPrice).eq(true);

    expect(wmatic1Diff < wmatic0Diff).eq(true);
  });

  it('price curve chart volatile', async function() {
    await writeFileSync('tmp/swap.txt', '', 'utf8');
    const p = await TestHelper.addLiquidity(
      factory,
      router,
      owner,
      mim.address,
      wmatic.address,
      BigNumber.from(100_000_000),
      BigNumber.from(100_000_000),
      false,
    );

    for (let i = 0; i < 10; i++) {
      await swap(p);
    }
  });

  it('average volume and reserves test', async function() {
    const observation0 = await pair.observations(0)

    // collect data for observation 1
    let reservesStart = await pair.getReserves()
    let expectedVolume0 = BigNumber.from(0)
    let expectedVolume1 = BigNumber.from(0)
    let swapAmount = utils.parseUnits('0.1', 6)
    let amountOut0 = await pair.getAmountOut(swapAmount, await pair.token1())
    await IERC20__factory.connect(await pair.token1(), owner).transfer(pair.address, swapAmount);
    await pair.swap(amountOut0, 0, owner.address, '0x');
    expectedVolume0 = expectedVolume0.add(amountOut0)
    expectedVolume1 = expectedVolume1.add(swapAmount)

    // add 61 minutes
    await TimeUtils.advanceBlocksOnTs(3600+60)
    swapAmount = utils.parseUnits('0.45', 6)
    amountOut0 = await pair.getAmountOut(swapAmount, await pair.token1())
    await IERC20__factory.connect(await pair.token1(), owner).transfer(pair.address, swapAmount);
    await pair.swap(amountOut0, 0, owner.address, '0x');
    expectedVolume0 = expectedVolume0.add(amountOut0)
    expectedVolume1 = expectedVolume1.add(swapAmount)
    let reservesEnd = await pair.getReserves()

    const observation1 = await pair.observations(1)
    expect(observation1.volume0Cumulative).eq(expectedVolume0)
    expect(observation1.volume1Cumulative).eq(expectedVolume1)

    let averageReserves = [
        observation1.reserve0Cumulative.div(observation1.timestamp.sub(observation0.timestamp)),
        observation1.reserve1Cumulative.div(observation1.timestamp.sub(observation0.timestamp)),
    ]
    expect(averageReserves[0]).lt(reservesStart[0])
    expect(averageReserves[0]).gt(reservesEnd[0])
    expect(averageReserves[1]).gt(reservesStart[1])
    expect(averageReserves[1]).lt(reservesEnd[1])

    // collect data for observation 2
    reservesStart = await pair.getReserves()
    expectedVolume0 = BigNumber.from(0)
    expectedVolume1 = BigNumber.from(0)
    swapAmount = utils.parseUnits('0.15', 6)
    amountOut0 = await pair.getAmountOut(swapAmount, await pair.token1())
    await IERC20__factory.connect(await pair.token1(), owner).transfer(pair.address, swapAmount);
    await pair.swap(amountOut0, 0, owner.address, '0x');
    expectedVolume0 = expectedVolume0.add(amountOut0)
    expectedVolume1 = expectedVolume1.add(swapAmount)
    // add 10 minutes
    await TimeUtils.advanceBlocksOnTs(600)
    amountOut0 = await pair.getAmountOut(swapAmount, await pair.token1())
    await IERC20__factory.connect(await pair.token1(), owner).transfer(pair.address, swapAmount);
    await pair.swap(amountOut0, 0, owner.address, '0x');
    expectedVolume0 = expectedVolume0.add(amountOut0)
    expectedVolume1 = expectedVolume1.add(swapAmount)

    // add 50 minutes
    await TimeUtils.advanceBlocksOnTs(3000)
    swapAmount = utils.parseUnits('0.01', 6)
    amountOut0 = await pair.getAmountOut(swapAmount, await pair.token1())
    await IERC20__factory.connect(await pair.token1(), owner).transfer(pair.address, swapAmount);
    await pair.swap(amountOut0, 0, owner.address, '0x');
    expectedVolume0 = expectedVolume0.add(amountOut0)
    expectedVolume1 = expectedVolume1.add(swapAmount)
    reservesEnd = await pair.getReserves()

    const observation2 = await pair.observations(2)
    expect(observation2.volume0Cumulative).eq(expectedVolume0)
    expect(observation2.volume1Cumulative).eq(expectedVolume1)
    averageReserves = [
      observation2.reserve0Cumulative.div(observation2.timestamp.sub(observation1.timestamp)),
      observation2.reserve1Cumulative.div(observation2.timestamp.sub(observation1.timestamp)),
    ]
    expect(averageReserves[0]).lt(reservesStart[0])
    expect(averageReserves[0]).gt(reservesEnd[0])
    expect(averageReserves[1]).gt(reservesStart[1])
    expect(averageReserves[1]).lt(reservesEnd[1])
  });

  /*it('price curve chart stable', async function() {
    // todo
  });

  it('mint manipultated with flashloan', async function() {
    // todo
  });

  it('burn manipultated with flashloan', async function() {
    // todo
  });

  it('flashloan cPair manipulation', async function() {
    // todo
  });

  it('move cPair reserve to exact rebalance threshold, then swap and try to arbitrage ', async function() {
    // todo
  });

  it('cPair reserves rebalance should move main pair reserves safly on repeated swaps', async function() {
    // todo
  });*/
});

async function swapInLoop(
  owner: SignerWithAddress,
  factory: RemoteFactory,
  router: RemoteRouter01,
  loops: number,
) {
  const amount = parseUnits('1');
  const tokenA = await Deploy.deployContract(owner, 'Token', 'UST', 'UST', 18, owner.address) as Token;
  await tokenA.mint(owner.address, amount.mul(100000));
  const tokenB = await Deploy.deployContract(owner, 'Token', 'MIM', 'MIM', 18, owner.address) as Token;
  await tokenB.mint(owner.address, amount.mul(100000));

  await TestHelper.addLiquidity(
    factory,
    router,
    owner,
    tokenA.address,
    tokenB.address,
    amount.mul(1),
    amount.mul(1),
    true,
  );

  const balB = await tokenB.balanceOf(owner.address);

  await tokenA.approve(router.address, parseUnits('100'));
  for (let i = 0; i < loops; i++) {
    await router.swapExactTokensForTokens(
      amount.div(100).div(loops),
      0,
      [{ from: tokenA.address, to: tokenB.address, stable: true }],
      owner.address,
      BigNumber.from('999999999999999999'),
    );
  }
  return (await tokenB.balanceOf(owner.address)).sub(balB);
}

async function prices(
  owner: SignerWithAddress,
  factory: RemoteFactory,
  router: RemoteRouter01,
  stable = true,
) {
  const tokenA = await Deploy.deployContract(owner, 'Token', 'UST', 'UST', 18, owner.address) as Token;
  await tokenA.mint(owner.address, utils.parseUnits('1'));
  const tokenB = await Deploy.deployContract(owner, 'Token', 'MIM', 'MIM', 18, owner.address) as Token;
  await tokenB.mint(owner.address, utils.parseUnits('1'));

  const amount = parseUnits('1');
  const loops = 100;

  const newPair = await TestHelper.addLiquidity(
    factory,
    router,
    owner,
    tokenA.address,
    tokenB.address,
    amount,
    amount,
    stable,
  );

  const price = parseUnits('1');

  for (let i = 0; i < loops; i++) {
    const amountIn = BigNumber.from(i + 1).mul(amount.div(loops));
    const out = await newPair.getAmountOut(amountIn, tokenA.address);
    const p = out.mul(parseUnits('1')).div(amountIn);
    const slippage = price.sub(p).mul(parseUnits('1')).div(price).mul(100);
    expect(+formatUnits(slippage)).is.below(51);
    // console.log(formatUnits(amountIn), formatUnits(out), formatUnits(p), formatUnits(slippage));
  }
}


function getStablePrice(reserveIn: number, reserveOut: number): number {
  return getAmountOut(1 / 18, reserveIn, reserveOut) * 18;
}

function getAmountOut(amountIn: number, reserveIn: number, reserveOut: number): number {
  const xy = _k(reserveIn, reserveOut);
  return reserveOut - _getY(amountIn + reserveIn, xy, reserveOut);
}

function _k(
  _x: number,
  _y: number,
): number {
  const _a = _x * _y;
  const _b = _x * _x + _y * _y;
  // x3y+y3x >= k
  return _a * _b;
}

function _getY(x0: number, xy: number, y: number): number {
  for (let i = 0; i < 255; i++) {
    const yPrev = y;
    const k = _f(x0, y);
    if (k < xy) {
      const dy = (xy - k) / _d(x0, y);
      y = y + dy;
    } else {
      const dy = (k - xy) / _d(x0, y);
      y = y - dy;
    }
    if (_closeTo(y, yPrev, 1)) {
      break;
    }
  }
  return y;
}

function _f(x0: number, y: number): number {
  return x0 * Math.pow(y, 3) + y * Math.pow(x0, 3);
}

function _d(x0: number, y: number): number {
  return 3 * x0 * y * y + Math.pow(x0, 3);
}

function _closeTo(a: number, b: number, target: number): boolean {
  if (a > b) {
    if (a - b < target) {
      return true;
    }
  } else {
    if (b - a < target) {
      return true;
    }
  }
  return false;
}

async function swap(pair: RemotePair, isTokenIn0 = true, amountIn = BigNumber.from(100_000)) {
  console.log(' ----------------------- START SWAP ------------------------------');
  const owner = await ethers.getSigner(await pair.signer.getAddress());
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  const cPair = await pair.concentratedPair();
  const balance0 = await IERC20__factory.connect(token0, owner).balanceOf(pair.address);
  const balance1 = await IERC20__factory.connect(token1, owner).balanceOf(pair.address);
  const cBalance0 = await IERC20__factory.connect(token0, owner).balanceOf(cPair);
  const cBalance1 = await IERC20__factory.connect(token1, owner).balanceOf(cPair);
  const price = await pair.lastPrice0to1();
  const cPrice = await ConcentratedPair__factory.connect(cPair, owner).price();


  console.log('balance0', balance0.toString());
  console.log('balance1', balance1.toString());
  console.log('cBalance0', cBalance0.toString());
  console.log('cBalance1', cBalance1.toString());
  console.log('cPrice', formatUnits(cPrice));
  console.log('PRICE', formatUnits(price));

  let tokenIn;
  if (isTokenIn0) {
    tokenIn = token0;
  } else {
    tokenIn = token1;
  }
  await IERC20__factory.connect(tokenIn, owner).transfer(pair.address, amountIn);
  const amountOut = await pair.getAmountOut(amountIn, tokenIn);
  console.log('amountIn', amountIn.toString());
  console.log('amountOut', amountOut.toString());

  console.log('$$$$$$$')
  await pair.swap(isTokenIn0 ? 0 : amountOut, isTokenIn0 ? amountOut : 0, owner.address, '0x');
  console.log('$$$$$$$')

  const balance0After = await IERC20__factory.connect(token0, owner).balanceOf(pair.address);
  const balance1After = await IERC20__factory.connect(token1, owner).balanceOf(pair.address);
  const cBalance0After = await IERC20__factory.connect(token0, owner).balanceOf(cPair);
  const cBalance1After = await IERC20__factory.connect(token1, owner).balanceOf(cPair);
  const priceAfter = await pair.lastPrice0to1();
  const cPriceAfter = await ConcentratedPair__factory.connect(cPair, owner).price();


  console.log('balance0 after', balance0After.toString());
  console.log('balance1 after', balance1After.toString());
  console.log('cBalance0 after', cBalance0After.toString());
  console.log('cBalance1 after', cBalance1After.toString());
  console.log('cPrice after', formatUnits(priceAfter));
  console.log('PRICE after', formatUnits(cPriceAfter));
  console.log(' -----------------------------------------------------');

  let data = '';
  data += balance0.toString() + ';';
  data += balance1.toString() + ';';
  data += cBalance0.toString() + ';';
  data += cBalance1.toString() + ';';
  data += formatUnits(cPrice) + ';';
  data += formatUnits(price) + ';';
  data += amountIn.toString() + ';';
  data += amountOut.toString() + ';';
  data += balance0After.toString() + ';';
  data += balance1After.toString() + ';';
  data += cBalance0After.toString() + ';';
  data += cBalance1After.toString() + ';';
  data += formatUnits(priceAfter) + ';';
  data += formatUnits(cPriceAfter);
  data += '\n';

  await appendFileSync('tmp/swap.txt', data, 'utf8');

  if (isTokenIn0) {
    expect(priceAfter.gte(price)).eq(true);
  } else {
    expect(priceAfter.lte(price)).eq(true);
  }
}
