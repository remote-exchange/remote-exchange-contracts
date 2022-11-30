// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "../../interface/IERC20.sol";
import "../../interface/IMultiRewardsPool.sol";
import "../../lib/Math.sol";
import "../../lib/SafeERC20.sol";
import "../Reentrancy.sol";

abstract contract MultiRewardsPoolBase is Reentrancy, IMultiRewardsPool {
  using SafeERC20 for IERC20;

  /// @dev Operator can add/remove reward tokens
  address public operator;

  /// @dev The LP token that needs to be staked for rewards
  address public immutable override underlying;

  uint public override derivedSupply;
  mapping(address => uint) public override derivedBalances;

  /// @dev Rewards are released over 7 days
  uint internal constant DURATION = 7 days;
  uint internal constant PRECISION = 10 ** 27;
  uint internal constant MAX_REWARD_TOKENS = 10;

  /// Default snx staking contract implementation
  /// https://github.com/Synthetixio/synthetix/blob/develop/contracts/StakingRewards.sol

  /// @dev Reward rate with precision 1e27
  mapping(address => uint) public rewardRate;
  mapping(address => uint) public periodFinish;
  mapping(address => uint) public lastUpdateTime;
  mapping(address => uint) public rewardPerTokenStored;

  mapping(address => mapping(address => uint)) public lastEarn;
  mapping(address => mapping(address => uint)) public userRewardPerTokenStored;
  /// @dev Reward token => Account => amount. Already paid reward amount for snapshot calculation.
  mapping(address => mapping(address => uint)) public userRewardPerTokenPaid;
  /// @dev Reward token => Account => amount. Snapshot of user's reward per token.
  mapping(address => mapping(address => uint)) public rewards;

  uint public override totalSupply;
  mapping(address => uint) public override balanceOf;

  address[] public override rewardTokens;
  mapping(address => bool) public override isRewardToken;

  event Deposit(address indexed from, uint amount);
  event Withdraw(address indexed from, uint amount);
  event NotifyReward(address indexed from, address indexed reward, uint amount);
  event ClaimRewards(address indexed from, address indexed reward, uint amount, address recepient);
  event ClaimRefRewards(address indexed referrer, address indexed reward, uint amount, address referral);

  constructor(address _stake, address _operator, address[] memory _allowedRewardTokens) {
    underlying = _stake;
    operator = _operator;
    for (uint i; i < _allowedRewardTokens.length; i++) {
      if (_allowedRewardTokens[i] != address(0)) {
        _registerRewardToken(_allowedRewardTokens[i]);
      }
    }
  }

  modifier onlyOperator() {
    require(msg.sender == operator, "Not operator");
    _;
  }

  //**************************************************************************
  //************************ VIEWS *******************************************
  //**************************************************************************

  function rewardTokensLength() external view override returns (uint) {
    return rewardTokens.length;
  }

  function rewardPerToken(address token) external view returns (uint) {
    return _rewardPerToken(token);
  }

  function _rewardPerToken(address token) internal view returns (uint) {
    if (derivedSupply == 0) {
      return rewardPerTokenStored[token];
    }
    return rewardPerTokenStored[token]
    + (
    (_lastTimeRewardApplicable(token) - lastUpdateTime[token])
    * rewardRate[token]
    / derivedSupply
    );
  }

  function derivedBalance(address account) external view override returns (uint) {
    return _derivedBalance(account);
  }

  function left(address token) external view override returns (uint) {
    if (block.timestamp >= periodFinish[token]) return 0;
    uint _remaining = periodFinish[token] - block.timestamp;
    return _remaining * rewardRate[token] / PRECISION;
  }

  function earned(address token, address account) external view virtual override returns (uint) {
    return _earned(token, account);
  }

  //**************************************************************************
  //************************ OPERATOR ACTIONS ********************************
  //**************************************************************************

  function registerRewardToken(address token) external onlyOperator {
    _registerRewardToken(token);
  }

  function _registerRewardToken(address token) internal {
    require(rewardTokens.length < MAX_REWARD_TOKENS, "Too many reward tokens");
    require(!isRewardToken[token], "Already registered");
    isRewardToken[token] = true;
    rewardTokens.push(token);
  }

  function removeRewardToken(address token) external onlyOperator {
    require(periodFinish[token] < block.timestamp, "Rewards not ended");
    require(isRewardToken[token], "Not reward token");

    isRewardToken[token] = false;
    uint length = rewardTokens.length;
    require(length > 3, "First 3 tokens should not be removed");
    // keep 3 tokens as guarantee against malicious actions
    // assume it will be REMOTE + pool tokens
    uint i = 3;
    bool found = false;
    for (; i < length; i++) {
      address t = rewardTokens[i];
      if (t == token) {
        found = true;
        break;
      }
    }
    require(found, "First tokens forbidden to remove");
    rewardTokens[i] = rewardTokens[length - 1];
    rewardTokens.pop();
  }

  //**************************************************************************
  //************************ USER ACTIONS ************************************
  //**************************************************************************

  function _deposit(uint amount) internal virtual lock {
    require(amount > 0, "Zero amount");
    _increaseBalance(msg.sender, amount);
    IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
    emit Deposit(msg.sender, amount);
  }

  function _increaseBalance(address account, uint amount) internal virtual {
    _updateRewardForAllTokens(account);

    totalSupply += amount;
    balanceOf[account] += amount;

    _updateDerivedBalance(account);
  }

  function _withdraw(uint amount) internal lock virtual {
    _decreaseBalance(msg.sender, amount);
    IERC20(underlying).safeTransfer(msg.sender, amount);
    emit Withdraw(msg.sender, amount);
  }

  function _decreaseBalance(address account, uint amount) internal virtual {
    _updateRewardForAllTokens(account);

    totalSupply -= amount;
    balanceOf[account] -= amount;

    _updateDerivedBalance(account);
  }

  /// @dev Implement restriction checks!
  function _getReward(address account, address[] memory tokens, address recipient, address refAddress) internal lock virtual {
    _updateDerivedBalance(account);

    for (uint i = 0; i < tokens.length; i++) {
      address rewardToken = tokens[i];
      _updateReward(rewardToken, account);

      uint _reward = rewards[rewardToken][account];
      lastEarn[rewardToken][account] = block.timestamp;

      userRewardPerTokenStored[tokens[i]][account] = rewardPerTokenStored[tokens[i]];
      if (_reward > 0) {
        /// @dev Extract ref reward 3%
        if (refAddress != address (0)) {
          uint _refReward = _reward * 3 / 100;
          _reward -= _refReward;
          IERC20(tokens[i]).safeTransfer(refAddress, _refReward);
          emit ClaimRefRewards(refAddress, tokens[i], _refReward, recipient);
        }

        rewards[rewardToken][account] = 0;
        IERC20(tokens[i]).safeTransfer(recipient, _reward);
      }

      emit ClaimRewards(msg.sender, tokens[i], _reward, recipient);
    }
  }

  function _updateDerivedBalance(address account) internal {
    uint __derivedBalance = derivedBalances[account];
    derivedSupply -= __derivedBalance;
    __derivedBalance = _derivedBalance(account);
    derivedBalances[account] = __derivedBalance;
    derivedSupply += __derivedBalance;
  }

  //**************************************************************************
  //************************ REWARDS CALCULATIONS ****************************
  //**************************************************************************

  // earned is an estimation, it won't be exact till the supply > rewardPerToken calculations have run
  function _earned(address token, address account) internal view returns (uint) {
    return _derivedBalance(account)
    * (_rewardPerToken(token) - userRewardPerTokenPaid[token][account])
    / PRECISION
    + rewards[token][account];
  }

  function _derivedBalance(address account) internal virtual view returns (uint) {
    // supposed to be implemented in a parent contract
    return balanceOf[account];
  }

  /// @dev Returns the last time the reward was modified or periodFinish if the reward has ended
  function _lastTimeRewardApplicable(address token) internal view returns (uint) {
    return Math.min(block.timestamp, periodFinish[token]);
  }

  function _updateRewardForAllTokens(address account) internal {
    address[] memory rts = rewardTokens;
    uint length = rts.length;
    for (uint i; i < length; i++) {
      _updateReward(rts[i], account);
    }
  }

  function _updateReward(address rewardToken, address account) internal {
    uint _rewardPerTokenStored = _rewardPerToken(rewardToken);

    rewardPerTokenStored[rewardToken] = _rewardPerTokenStored;
    lastUpdateTime[rewardToken] = _lastTimeRewardApplicable(rewardToken);
    if (account != address(0)) {
      rewards[rewardToken][account] = _earned(rewardToken, account);
      userRewardPerTokenPaid[rewardToken][account] = _rewardPerTokenStored;
    }
  }

  //**************************************************************************
  //************************ NOTIFY ******************************************
  //**************************************************************************

  function _notifyRewardAmount(address token, uint amount) internal lock virtual {
    require(token != underlying, "Wrong token for rewards");
    require(amount > 0, "Zero amount");
    require(isRewardToken[token], "Token not allowed");

    _updateReward(token, address(0));

    uint balanceBefore = IERC20(token).balanceOf(address(this));
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    // refresh amount if token was taxable
    amount = IERC20(token).balanceOf(address(this)) - balanceBefore;

    if (block.timestamp >= periodFinish[token]) {
      rewardRate[token] = amount * PRECISION / DURATION;
    } else {
      uint _remaining = periodFinish[token] - block.timestamp;
      uint _left = _remaining * rewardRate[token];
      // rewards should not extend period infinity, only higher amount allowed
      require(amount > _left / PRECISION, "Amount should be higher than remaining rewards");
      rewardRate[token] = (amount * PRECISION + _left) / DURATION;
    }

    lastUpdateTime[token] = block.timestamp;
    periodFinish[token] = block.timestamp + DURATION;
    emit NotifyReward(msg.sender, token, amount);
  }
}
