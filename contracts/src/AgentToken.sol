// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentToken - NFT Representation of AI Agents
/// @notice ERC-721 tokens representing ownership of AI agents with revenue sharing
/// @dev Implements ERC-721, ERC-2981 (royalties), and custom revenue distribution
contract AgentToken is ERC721URIStorage, ERC721Royalty, AccessControlEnumerable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    /// @notice Information about a minted agent
    struct AgentInfo {
        bytes32 didHash; // Agent's DID hash
        string capabilityCID; // IPFS CID of capability card
        uint256 mintedAt; // Timestamp of minting
        bool isActive; // Whether the agent is active
        uint96 royaltyBps; // Original royalty basis points (stored for safe transfer)
    }

    // ============ Constants ============

    /// @notice Maximum royalty (10%)
    uint96 public constant MAX_ROYALTY_BPS = 1000;

    // ============ State Variables ============

    /// @notice USDC token for payments
    IERC20 public immutable usdc;

    /// @notice Treasury address for mint fees
    address public treasury;

    /// @notice Mint fee in USDC (6 decimals)
    uint256 public mintFee;

    /// @notice Token ID counter
    uint256 private _nextTokenId;

    /// @notice Total number of minted agents
    uint256 private _totalAgents;

    /// @notice Mapping from token ID to agent info
    mapping(uint256 => AgentInfo) private _agents;

    /// @notice Mapping from DID hash to token ID
    mapping(bytes32 => uint256) private _didToToken;

    /// @notice Mapping from token ID to accumulated revenue
    mapping(uint256 => uint256) private _accumulatedRevenue;

    // ============ Events ============

    /// @notice Emitted when an agent is minted
    event AgentMinted(uint256 indexed tokenId, bytes32 indexed didHash, address indexed owner);

    /// @notice Emitted when an agent is burned
    event AgentBurned(uint256 indexed tokenId, bytes32 indexed didHash);

    /// @notice Emitted when revenue is deposited
    event RevenueDeposited(uint256 indexed tokenId, uint256 amount);

    /// @notice Emitted when revenue is claimed
    event RevenueClaimed(uint256 indexed tokenId, address indexed claimant, uint256 amount);

    /// @notice Emitted when royalty is set
    event RoyaltySet(uint256 indexed tokenId, uint96 royaltyBps);

    /// @notice Emitted when mint fee is set
    event MintFeeSet(uint256 fee);

    /// @notice Emitted when treasury is set
    event TreasurySet(address treasury);

    // ============ Errors ============

    error InvalidAddress();
    error AgentAlreadyMinted();
    error NotTokenOwner();
    error NoRevenueToClaim();
    error RoyaltyTooHigh();
    error TokenNotFound();
    error InvalidDIDHash();

    // ============ Constructor ============

    /// @notice Initialize the AgentToken contract
    /// @param name Token name
    /// @param symbol Token symbol
    /// @param _usdc USDC token address
    /// @param _treasury Treasury address
    /// @param _admin Admin address
    constructor(string memory name, string memory symbol, address _usdc, address _treasury, address _admin)
        ERC721(name, symbol)
    {
        if (_usdc == address(0)) revert InvalidAddress();
        if (_treasury == address(0)) revert InvalidAddress();
        if (_admin == address(0)) revert InvalidAddress();

        usdc = IERC20(_usdc);
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ============ Minting Functions ============

    /// @notice Mint a new agent token
    /// @param didHash Agent's DID hash
    /// @param capabilityCID IPFS CID of capability card
    /// @param uri Token URI
    /// @param royaltyBps Royalty in basis points (max 1000 = 10%)
    /// @return tokenId The new token ID
    function mintAgent(bytes32 didHash, string calldata capabilityCID, string calldata uri, uint96 royaltyBps)
        external
        nonReentrant
        returns (uint256 tokenId)
    {
        if (didHash == bytes32(0)) revert InvalidDIDHash();
        if (_didToToken[didHash] != 0) revert AgentAlreadyMinted();
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();

        // Collect mint fee if set
        if (mintFee > 0) {
            usdc.safeTransferFrom(msg.sender, treasury, mintFee);
        }

        // Mint token
        tokenId = ++_nextTokenId;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);

        // Store agent info
        _agents[tokenId] = AgentInfo({
            didHash: didHash,
            capabilityCID: capabilityCID,
            mintedAt: block.timestamp,
            isActive: true,
            royaltyBps: royaltyBps
        });

        _didToToken[didHash] = tokenId;
        _totalAgents++;

        // Set royalty
        _setTokenRoyalty(tokenId, msg.sender, royaltyBps);

        emit AgentMinted(tokenId, didHash, msg.sender);
    }

    /// @notice Burn an agent token
    /// @param tokenId Token ID to burn
    function burnAgent(uint256 tokenId) external nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        bytes32 didHash = _agents[tokenId].didHash;

        // Claim any remaining revenue
        if (_accumulatedRevenue[tokenId] > 0) {
            _claimRevenue(tokenId, msg.sender);
        }

        // Clear storage
        delete _didToToken[didHash];
        delete _agents[tokenId];
        _totalAgents--;

        // Burn token
        _burn(tokenId);

        emit AgentBurned(tokenId, didHash);
    }

    // ============ Revenue Functions ============

    /// @notice Deposit revenue for an agent
    /// @param tokenId Token ID
    /// @param amount Amount to deposit
    function depositRevenue(uint256 tokenId, uint256 amount) external nonReentrant {
        if (_agents[tokenId].mintedAt == 0) revert TokenNotFound();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _accumulatedRevenue[tokenId] += amount;

        emit RevenueDeposited(tokenId, amount);
    }

    /// @notice Claim accumulated revenue
    /// @param tokenId Token ID
    function claimRevenue(uint256 tokenId) external nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        _claimRevenue(tokenId, msg.sender);
    }

    /// @notice Internal function to claim revenue
    /// @param tokenId Token ID
    /// @param recipient Recipient address
    function _claimRevenue(uint256 tokenId, address recipient) internal {
        uint256 amount = _accumulatedRevenue[tokenId];
        if (amount == 0) revert NoRevenueToClaim();

        _accumulatedRevenue[tokenId] = 0;
        usdc.safeTransfer(recipient, amount);

        emit RevenueClaimed(tokenId, recipient, amount);
    }

    // ============ Royalty Functions ============

    /// @notice Set royalty for a token
    /// @param tokenId Token ID
    /// @param royaltyBps Royalty in basis points
    function setRoyalty(uint256 tokenId, uint96 royaltyBps) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();

        _setTokenRoyalty(tokenId, msg.sender, royaltyBps);

        emit RoyaltySet(tokenId, royaltyBps);
    }

    // ============ Update Functions ============

    /// @notice Update capability CID
    /// @param tokenId Token ID
    /// @param newCID New IPFS CID
    function updateCapabilityCID(uint256 tokenId, string calldata newCID) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        _agents[tokenId].capabilityCID = newCID;
    }

    /// @notice Deactivate an agent
    /// @param tokenId Token ID
    function deactivateAgent(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        _agents[tokenId].isActive = false;
    }

    /// @notice Activate an agent
    /// @param tokenId Token ID
    function activateAgent(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        _agents[tokenId].isActive = true;
    }

    // ============ Admin Functions ============

    /// @notice Set mint fee
    /// @param fee New mint fee
    function setMintFee(uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintFee = fee;
        emit MintFeeSet(fee);
    }

    /// @notice Set treasury address
    /// @param _treasury New treasury address
    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_treasury == address(0)) revert InvalidAddress();
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    // ============ View Functions ============

    /// @notice Get agent info
    /// @param tokenId Token ID
    /// @return didHash Agent's DID hash
    /// @return capabilityCID IPFS CID
    /// @return mintedAt Minted timestamp
    /// @return active Whether active
    function getAgentInfo(uint256 tokenId)
        external
        view
        returns (bytes32 didHash, string memory capabilityCID, uint256 mintedAt, bool active)
    {
        AgentInfo storage info = _agents[tokenId];
        return (info.didHash, info.capabilityCID, info.mintedAt, info.isActive);
    }

    /// @notice Get token ID by DID
    /// @param didHash Agent's DID hash
    /// @return Token ID (0 if not minted)
    function getTokenByDID(bytes32 didHash) external view returns (uint256) {
        return _didToToken[didHash];
    }

    /// @notice Check if agent is active
    /// @param tokenId Token ID
    /// @return Whether active
    function isAgentActive(uint256 tokenId) external view returns (bool) {
        return _agents[tokenId].isActive;
    }

    /// @notice Get accumulated revenue
    /// @param tokenId Token ID
    /// @return Accumulated revenue
    function getAccumulatedRevenue(uint256 tokenId) external view returns (uint256) {
        return _accumulatedRevenue[tokenId];
    }

    /// @notice Get total number of agents
    /// @return Total agents
    function totalAgents() external view returns (uint256) {
        return _totalAgents;
    }

    // ============ Override Functions ============

    /// @notice Override supportsInterface
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC721Royalty, AccessControlEnumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Override tokenURI
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    /// @notice Override _update for transfer tracking
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);

        // Update royalty receiver on transfer (use stored BPS, not royaltyInfo round-trip)
        if (from != address(0) && to != address(0)) {
            _setTokenRoyalty(tokenId, to, _agents[tokenId].royaltyBps);
        }

        return from;
    }

    /// @dev Override to resolve inheritance conflict
    function _increaseBalance(address account, uint128 value) internal override(ERC721) {
        super._increaseBalance(account, value);
    }
}
