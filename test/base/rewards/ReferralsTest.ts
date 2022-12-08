import {
  RemotePair,
  RemotePair__factory,
  Gauge,
  Gauge__factory,
  Token
} from "../../../typechain";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import chai from "chai";
import {CoreAddresses} from "../../../scripts/deploy/CoreAddresses";
import {Deploy} from "../../../scripts/deploy/Deploy";
import {BigNumber, utils} from "ethers";
import {TestHelper} from "../../TestHelper";
import {TimeUtils} from "../../TimeUtils";
import {formatUnits, parseUnits} from "ethers/lib/utils";

const {expect} = chai;

const amount1000At6 = parseUnits('1000', 6);
const WEEK = 60 * 60 * 24 * 7;

describe("referrals test", function () {

  let snapshotBefore: string;
  let snapshot: string;

  let owner: SignerWithAddress;
  let owner2: SignerWithAddress;
  let owner3: SignerWithAddress;
  let owner4: SignerWithAddress;
  let owner5: SignerWithAddress;
  let owner6: SignerWithAddress;
  let owner7: SignerWithAddress;
  let owner8: SignerWithAddress;
  let core: CoreAddresses;
  let ust: Token;
  let mim: Token;
  let wmatic: Token;
  let mimUstPair: RemotePair;
  let gaugeMimUst: Gauge;

  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();
    [owner, owner2, owner3, owner4, owner5, owner6, owner7, owner8] = await ethers.getSigners();

    wmatic = await Deploy.deployContract(owner, 'Token', 'WMATIC', 'WMATIC', 18, owner.address) as Token;
    await wmatic.mint(owner.address, parseUnits('100000'));

    [ust, mim] = await TestHelper.createMockTokensAndMint(owner);
    await ust.transfer(owner2.address, utils.parseUnits('100', 6));
    await mim.transfer(owner2.address, utils.parseUnits('100'));

    await ust.transfer(owner3.address, utils.parseUnits('100', 6));
    await mim.transfer(owner3.address, utils.parseUnits('100'));

    await ust.transfer(owner4.address, utils.parseUnits('100', 6));
    await mim.transfer(owner4.address, utils.parseUnits('100'));
    await ust.transfer(owner5.address, utils.parseUnits('100', 6));
    await mim.transfer(owner5.address, utils.parseUnits('100'));
    await ust.transfer(owner6.address, utils.parseUnits('100', 6));
    await mim.transfer(owner6.address, utils.parseUnits('100'));
    await ust.transfer(owner7.address, utils.parseUnits('100', 6));
    await mim.transfer(owner7.address, utils.parseUnits('100'));
    await ust.transfer(owner8.address, utils.parseUnits('100', 6));
    await mim.transfer(owner8.address, utils.parseUnits('100'));

    core = await Deploy.deployCore(
      owner,
      wmatic.address,
      [wmatic.address, ust.address, mim.address, /*dai.address*/],
      [owner.address, owner2.address, owner.address],
      [utils.parseUnits('100'), utils.parseUnits('100'), BigNumber.from(100)],
      utils.parseUnits('200').add(100),
      2,
        false
    );

    mimUstPair = await TestHelper.addLiquidity(
      core.factory,
      core.router,
      owner,
      mim.address,
      ust.address,
      utils.parseUnits('1'),
      utils.parseUnits('1', 6),
      true
    );

    // ------------- setup gauges and bribes --------------

    await core.token.approve(core.voter.address, BigNumber.from("1500000000000000000000000"));
    await core.voter.createGauge(mimUstPair.address);
    expect(await core.voter.gauges(mimUstPair.address)).to.not.equal(0x0000000000000000000000000000000000000000);

    const gaugeMimUstAddress = await core.voter.gauges(mimUstPair.address);

    gaugeMimUst = Gauge__factory.connect(gaugeMimUstAddress, owner);

    await TestHelper.depositToGauge(owner, gaugeMimUst, mimUstPair, amount1000At6, 1);

    expect(await gaugeMimUst.totalSupply()).to.equal(amount1000At6);
    expect(await gaugeMimUst.earned(core.ve.address, owner.address)).to.equal(0);
  });

  after(async function () {
    await TimeUtils.rollback(snapshotBefore);
  });


  beforeEach(async function () {
    snapshot = await TimeUtils.snapshot();
  });

  afterEach(async function () {
    await TimeUtils.rollback(snapshot);
  });

  it("ve boost test", async function () {
    await core.voter.vote(1, [mimUstPair.address], [100]);
    const veBal = await core.ve.balanceOfNFT(2)
    expect(veBal).is.not.eq(0);
    expect(await core.ve.balanceOf(owner3.address)).is.eq(0);

    await depositToGauge(core, owner3, mim.address, ust.address, gaugeMimUst, 0);

    await TimeUtils.advanceBlocksOnTs(WEEK * 2);
    await core.minter.updatePeriod()
    await core.voter.distributeAll();

    await TimeUtils.advanceBlocksOnTs(WEEK);

    await gaugeMimUst.connect(owner3).getReward(owner3.address, [core.token.address]);

    await gaugeMimUst.connect(owner3).withdrawAll();

    const nft4LockAmount = parseUnits('100')
    const nft5LockAmount = parseUnits('100')
    const nft6LockAmount = parseUnits('1')
    const nft7LockAmount = parseUnits('1')

    await core.token.connect(owner3).transfer(owner4.address, nft4LockAmount);
    await core.token.connect(owner3).transfer(owner5.address, nft5LockAmount);
    await core.token.connect(owner3).transfer(owner6.address, nft6LockAmount);
    await core.token.connect(owner3).transfer(owner7.address, nft6LockAmount);
    await core.token.connect(owner4).approve(core.ve.address, nft4LockAmount);
    await core.token.connect(owner5).approve(core.ve.address, nft5LockAmount);
    await core.token.connect(owner6).approve(core.ve.address, nft6LockAmount);
    await core.token.connect(owner7).approve(core.ve.address, nft7LockAmount);
    await core.ve.connect(owner4).createLock(nft4LockAmount, 60 * 60 * 24 * 365 * 4, 2);
    await core.ve.connect(owner5).createLock(nft5LockAmount, 60 * 60 * 24 * 365 * 4, 0);
    await core.ve.connect(owner6).createLock(nft6LockAmount, 60 * 60 * 24 * 365 * 4, 2);
    await core.ve.connect(owner7).createLock(nft7LockAmount, 60 * 60 * 24 * 365 * 4, 0);
    expect(await core.ve.balanceOf(owner4.address)).is.eq('1');
    expect(await core.ve.balanceOf(owner5.address)).is.eq('1');
    expect(await core.ve.balanceOf(owner6.address)).is.eq('1');
    expect(await core.ve.balanceOf(owner7.address)).is.eq('1');
    expect(await core.ve.balanceOf(owner8.address)).is.eq('0');

    await depositToGauge(core, owner4, mim.address, ust.address, gaugeMimUst, 4);
    await depositToGauge(core, owner5, mim.address, ust.address, gaugeMimUst, 5);
    await depositToGauge(core, owner6, mim.address, ust.address, gaugeMimUst, 6);
    await depositToGauge(core, owner7, mim.address, ust.address, gaugeMimUst, 7);
    await depositToGauge(core, owner8, mim.address, ust.address, gaugeMimUst, 0);

    await TimeUtils.advanceBlocksOnTs(WEEK);

    const reward4 = await gaugeMimUst.earned(core.token.address, owner4.address);
    const reward5 = await gaugeMimUst.earned(core.token.address, owner5.address);
    const reward6 = await gaugeMimUst.earned(core.token.address, owner6.address);
    const reward7 = await gaugeMimUst.earned(core.token.address, owner7.address);
    const rewardNoBoost = await gaugeMimUst.earned(core.token.address, owner8.address);

    const totalPower = await core.ve.totalSupply();
    const nft4Power = await core.ve.balanceOfNFT(4)
    const nft5Power = await core.ve.balanceOfNFT(5)
    const nft6Power = await core.ve.balanceOfNFT(6)
    const nft7Power = await core.ve.balanceOfNFT(7)

    console.log(`Deposit of 1.0 UST + 1.0 MIM LP to gauge`)
    console.log(`Total voting power: ${formatUnits(totalPower)} veREMOTE`)
    console.log(`Earned for ${formatUnits(nft4Power)} veREMOTE ${parseInt(nft4Power.mul(10000).div(totalPower))/100}% NFT with referrer: ${formatUnits(reward4)}; boost = x${parseInt(reward4.mul(1000).div(rewardNoBoost))/1000} (reward with max boost - 3% of referrer's share)`);
    console.log(`Earned for ${formatUnits(nft5Power)} veREMOTE ${parseInt(nft5Power.mul(10000).div(totalPower))/100}% NFT without referrer: ${formatUnits(reward5)}; boost = x${parseInt(reward5.mul(1000).div(rewardNoBoost))/1000} (max boost)`);
    console.log(`Earned for ${formatUnits(nft6Power)} veREMOTE ${parseInt(nft6Power.mul(10000).div(totalPower))/100}% NFT with referrer: ${formatUnits(reward6)}; boost = x${parseInt(reward6.mul(1000).div(rewardNoBoost))/1000} (reward with x1.1 boost - 3% of referrer's share)`);
    console.log(`Earned for ${formatUnits(nft7Power)} veREMOTE ${parseInt(nft7Power.mul(10000).div(totalPower))/100}% NFT without referrer: ${formatUnits(reward7)}; boost = x${parseInt(reward7.mul(1000).div(rewardNoBoost))/1000}`);
    console.log(`Earned without NFT and referrer: ${formatUnits(rewardNoBoost)}; boost = x1.000 (no boost)`);

    // check max boost: x2.5
    expect(reward5.mul(1000).div(rewardNoBoost)).to.eq(2500)

    // check referral max boost: x2.425 of reward with max boost - 3% of referrer's share
    expect(reward4.mul(1000).div(rewardNoBoost)).to.eq(2425)

    // check referral boost for 0.25% power veNFT: about x1.1 of reward + 3% of referrer's share
    expect(reward6.div(97).mul(100).mul(10).div(rewardNoBoost)).to.eq(11)

    await gaugeMimUst.connect(owner4).getReward(owner4.address, [core.token.address]);
    expect(await gaugeMimUst.earned(core.token.address, owner4.address)).to.eq(0)
    await gaugeMimUst.connect(owner5).getReward(owner5.address, [core.token.address]);
    expect(await gaugeMimUst.earned(core.token.address, owner5.address)).to.eq(0)
  });

});

async function depositToGauge(
  core: CoreAddresses,
  owner: SignerWithAddress,
  token0: string,
  token1: string,
  gauge: Gauge,
  tokenId: number
) {
  await TestHelper.addLiquidity(
    core.factory,
    core.router,
    owner,
    token0,
    token1,
    utils.parseUnits('1'),
    utils.parseUnits('1', 6),
    true,
      false
  );
  const pairAdr = await core.factory.getPair(token0, token1, true)
  const pair = RemotePair__factory.connect(pairAdr, owner);
  const pairBalance = await pair.balanceOf(owner.address);
  expect(pairBalance).is.not.eq(0);
  await pair.approve(gauge.address, pairBalance);
  await gauge.connect(owner).deposit(pairBalance, tokenId);
}
