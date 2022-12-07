// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "../../interface/IBribe.sol";
import "../../interface/IERC20.sol";
import "../../interface/IERC721.sol";
import "../../interface/IVoter.sol";
import "../../interface/IMinter.sol";
import "../../interface/IVe.sol";
import "./MultiRewardsPoolBase.sol";
import "../Reentrancy.sol";

/// @title Bribes pay out rewards for a given pool based on the votes
///        that were received from the user (goes hand in hand with Gauges.vote())
contract Bribe is IBribe, MultiRewardsPoolBase {

  using SafeERC20 for IERC20;

  uint internal constant _WEEK = 86400 * 7;

  /// @dev Only voter can modify balances (since it only happens on vote())
  address public immutable voter;
  address public immutable ve;

  /// @dev rt => epoch => amount
  mapping(address => mapping(uint => uint)) public rewardsQueue;

  event RewardsForNextEpoch(address token, uint epoch, uint amount);
  event DelayedRewardsNotified(address token, uint epoch, uint amount);

  // Assume that will be created from voter contract through factory
  constructor(
    address _voter,
    address[] memory _allowedRewardTokens
  ) MultiRewardsPoolBase(address(0), _voter, _allowedRewardTokens) {
    voter = _voter;
    ve = IVoter(_voter).ve();
  }

  function getReward(uint tokenId, address[] memory tokens) external {
    require(IVe(ve).isApprovedOrOwner(msg.sender, tokenId), "Not token owner");
    _getReward(_tokenIdToAddress(tokenId), tokens, msg.sender, address(0));
  }

  /// @dev Used by Voter to allow batched reward claims
  function getRewardForOwner(uint tokenId, address[] memory tokens) external override {
    require(msg.sender == voter, "Not voter");
    address owner = IERC721(ve).ownerOf(tokenId);
    _getReward(_tokenIdToAddress(tokenId), tokens, owner, address(0));
  }

  /// @dev This is an external function, but internal notation is used
  ///      since it can only be called "internally" from Gauges
  function _deposit(uint amount, uint tokenId) external override {
    require(msg.sender == voter, "Not voter");
    require(amount > 0, "Zero amount");

    address adr = _tokenIdToAddress(tokenId);
    _increaseBalance(adr, amount);
    emit Deposit(adr, amount);
  }

  function _withdraw(uint amount, uint tokenId) external override {
    require(msg.sender == voter, "Not voter");
    require(amount > 0, "Zero amount");

    address adr = _tokenIdToAddress(tokenId);
    _decreaseBalance(adr, amount);
    emit Withdraw(adr, amount);
  }

  /// @dev Used to notify a gauge/bribe of a given reward,
  ///      this can create griefing attacks by extending rewards
  function notifyRewardAmount(address token, uint amount) external lock override {
    _notifyRewardAmount(token, amount, true);
  }

  /// @dev Add delayed rewards for the next epoch
  function notifyForNextEpoch(address token, uint amount) external lock override {
    require(isRewardToken[token], "Token not allowed");

    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

    uint _epoch = epoch() + 1;
    rewardsQueue[token][_epoch] = amount;

    emit RewardsForNextEpoch(token, _epoch, amount);
  }

  /// @dev Notify delayed rewards
  function notifyDelayedRewards(address token, uint _epoch) external lock override {
    require(epoch() == _epoch, "!epoch");
    _notifyDelayedRewards(token, _epoch);
  }

  function _notifyDelayedRewards(address token, uint _epoch) internal {
    uint amount = rewardsQueue[token][_epoch];
    if (amount != 0 && amount > left(token)) {
      _notifyRewardAmount(token, amount, false);
      delete rewardsQueue[token][_epoch];
      emit DelayedRewardsNotified(token, epoch(), amount);
    }
  }

  function epoch() public view returns(uint) {
    return IMinter(IVoter(voter).minter()).activePeriod() / _WEEK - 1;
  }

  // use tokenId instead of address for

  function tokenIdToAddress(uint tokenId) external pure returns (address) {
    return _tokenIdToAddress(tokenId);
  }

  function _tokenIdToAddress(uint tokenId) internal pure returns (address) {
    address adr = address(uint160(tokenId));
    require(_addressToTokenId(adr) == tokenId, "Wrong convert");
    return adr;
  }

  function addressToTokenId(address adr) external pure returns (uint) {
    return _addressToTokenId(adr);
  }

  function _addressToTokenId(address adr) internal pure returns (uint) {
    return uint(uint160(adr));
  }

}
