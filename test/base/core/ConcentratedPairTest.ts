import { ConcentratedPair, IUnderlying__factory, Token } from '../../../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import chai from 'chai';
import { Deploy } from '../../../scripts/deploy/Deploy';
import { TimeUtils } from '../../TimeUtils';
import { formatUnits, parseUnits } from 'ethers/lib/utils';

const { expect } = chai;

describe('ConcentratedPairTest', function() {

  let snapshotBefore: string;
  let snapshot: string;

  let owner: SignerWithAddress;
  let owner2: SignerWithAddress;
  let pair: ConcentratedPair;
  let wbtc0: Token;
  let usdc1: Token;


  before(async function() {
    snapshotBefore = await TimeUtils.snapshot();
    [owner, owner2] = await ethers.getSigners();
    wbtc0 = await Deploy.deployContract(owner, 'Token', 'WBTC', 'WBTC', 8, owner.address) as Token;
    usdc1 = await Deploy.deployContract(owner, 'Token', 'USDC', 'USDC', 6, owner.address) as Token;
    pair = await Deploy.deployContract(owner, 'ConcentratedPair', wbtc0.address, usdc1.address) as ConcentratedPair;
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

  it('only pair allowed test', async function() {
    await expect(pair.connect(owner2).setPrice(1)).revertedWith('!pair');
  });

  it('get amount out test', async function() {
    await usdc1.mint(pair.address, parseUnits('2', 6));
    await wbtc0.mint(pair.address, parseUnits('1', 8));

    await pair.setPrice(parseUnits('2'));

    expect((await getAmountOut(pair, 0.1, false)).out).eq(0.05);
    expect((await getAmountOut(pair, 0.1, false)).remaining).eq(0);

    expect((await getAmountOut(pair, 0.1, true)).out).eq(0.2);
    expect((await getAmountOut(pair, 0.1, true)).remaining).eq(0);

    expect((await getAmountOut(pair, 2, true)).out).eq(2);
    expect((await getAmountOut(pair, 2, true)).remaining).eq(1);

    expect((await getAmountOut(pair, 5, false)).out).eq(1);
    expect((await getAmountOut(pair, 5, false)).remaining).eq(3);
  });

  it('get amount in test', async function() {
    await usdc1.mint(pair.address, parseUnits('2', 6));
    await wbtc0.mint(pair.address, parseUnits('1', 8));

    await pair.setPrice(parseUnits('2'));

    expect((await getAmountIn(pair, 0.1, true)).amountIn).eq(0.2);
    expect((await getAmountIn(pair, 0.1, true)).remainingOut).eq(0);

    expect((await getAmountIn(pair, 0.1, false)).amountIn).eq(0.05);
    expect((await getAmountIn(pair, 0.1, false)).remainingOut).eq(0);

    expect((await getAmountIn(pair, 4, false)).amountIn).eq(1);
    expect((await getAmountIn(pair, 4, false)).remainingOut).eq(2);

    expect((await getAmountIn(pair, 5, true)).amountIn).eq(2);
    expect((await getAmountIn(pair, 5, true)).remainingOut).eq(4);
  });

});

async function getAmountOut(pair: ConcentratedPair, amount: number, isTokenIn0: boolean) {
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  const dec0 = await IUnderlying__factory.connect(token0, pair.provider).decimals();
  const dec1 = await IUnderlying__factory.connect(token1, pair.provider).decimals();

  const decIn = isTokenIn0 ? dec0 : dec1;
  const decOut = isTokenIn0 ? dec1 : dec0;

  const amountIn = parseUnits(amount.toFixed(decIn), decIn);
  const data = await pair.getAmountOut(amountIn, isTokenIn0 ? token0 : token1);

  return {
    out: +formatUnits(data.amountOut, decOut),
    remaining: +formatUnits(data.amountInRemaining, decIn),
  };
}

async function getAmountIn(pair: ConcentratedPair, amount: number, isTokenOut0: boolean) {
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  const dec0 = await IUnderlying__factory.connect(token0, pair.provider).decimals();
  const dec1 = await IUnderlying__factory.connect(token1, pair.provider).decimals();

  const decOut = isTokenOut0 ? dec0 : dec1;
  const decIn = isTokenOut0 ? dec1 : dec0;

  const amountOut = parseUnits(amount.toFixed(decOut), decOut);
  const data = await pair.getAmountIn(isTokenOut0 ? amountOut : 0, isTokenOut0 ? 0 : amountOut);

  const amountIn = isTokenOut0 ?
    +formatUnits(data.amountIn1, decIn)
    : +formatUnits(data.amountIn0, decIn);
  const remainingOut = isTokenOut0 ?
    +formatUnits(data.amount0OutRemaining, decOut)
    : +formatUnits(data.amount1OutRemaining, decOut);

  return {
    amountIn,
    remainingOut,
  };
}
