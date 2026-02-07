// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "./interfaces/ICrossChainTrustSync.sol";
import "./interfaces/IChainRegistry.sol";

/// @title CrossChainTrustSync - Cross-Chain Trust Score Synchronization
/// @notice Manages synchronization of trust scores across chains
/// @dev Implements ICrossChainTrustSync with LayerZero V2 pattern (OApp-ready).
///      This contract provides the trust caching layer. Full LayerZero
///      integration requires the OApp base contract from layerzero-labs.
contract CrossChainTrustSync is ICrossChainTrustSync, AccessControlEnumerable {
    // ============ Constants ============

    /// @notice Message type for trust score sync
    uint8 public constant MSG_TYPE_TRUST_SYNC = 1;

    /// @notice Message type for trust score query
    uint8 public constant MSG_TYPE_TRUST_QUERY = 2;

    /// @notice Maximum trust score (basis points)
    uint256 public constant MAX_TRUST_SCORE = 10000;

    /// @notice Default cache TTL (1 day)
    uint256 public constant DEFAULT_CACHE_TTL = 1 days;

    // ============ State Variables ============

    /// @notice Reference to the ChainRegistry contract
    IChainRegistry public immutable chainRegistry;

    /// @notice LayerZero endpoint address
    address public immutable endpoint;

    /// @notice Primary chain ID (canonical source of trust)
    uint64 public primaryChainId;

    /// @notice Cache TTL in seconds
    uint256 public cacheTTL;

    /// @notice Mapping from endpoint ID to peer contract address
    mapping(uint32 => bytes32) public peers;

    /// @notice Array of configured endpoint IDs
    uint32[] private _peerEids;

    /// @notice Mapping to track peer index
    mapping(uint32 => uint256) private _peerIndex;

    /// @notice Mapping to check if peer exists
    mapping(uint32 => bool) private _peerExists;

    /// @notice Mapping from DID hash to cached trust score
    mapping(bytes32 => CachedTrustScore) private _trustCache;

    // ============ Errors ============

    error InvalidChainRegistry();
    error InvalidEndpoint();
    error InvalidAdmin();
    error InvalidTrustScore();
    error ChainNotSupported();
    error PeerNotSet();
    error ArrayLengthMismatch();
    error InsufficientFee();
    error OnlyTrustRegistry();

    // ============ Constructor ============

    /// @notice Initialize the CrossChainTrustSync contract
    /// @param _chainRegistry Address of the ChainRegistry contract
    /// @param _endpoint Address of the LayerZero endpoint
    /// @param _admin Address of the admin
    constructor(address _chainRegistry, address _endpoint, address _admin) {
        if (_chainRegistry == address(0)) revert InvalidChainRegistry();
        if (_endpoint == address(0)) revert InvalidEndpoint();
        if (_admin == address(0)) revert InvalidAdmin();

        chainRegistry = IChainRegistry(_chainRegistry);
        endpoint = _endpoint;
        cacheTTL = DEFAULT_CACHE_TTL;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ============ Configuration Functions ============

    /// @inheritdoc ICrossChainTrustSync
    function setPrimaryChain(uint64 chainId) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!chainRegistry.isChainSupported(chainId)) revert ChainNotSupported();

        primaryChainId = chainId;

        emit PrimaryChainSet(chainId);
    }

    /// @inheritdoc ICrossChainTrustSync
    function setPeer(uint32 eid, bytes32 peer) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_peerExists[eid]) {
            _peerIndex[eid] = _peerEids.length;
            _peerEids.push(eid);
            _peerExists[eid] = true;
        }

        peers[eid] = peer;

        emit PeerSet(eid, peer);
    }

    /// @inheritdoc ICrossChainTrustSync
    function setCacheTTL(uint256 ttl) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        cacheTTL = ttl;
        emit CacheTTLUpdated(ttl);
    }

    // ============ Trust Sync Functions ============

    /// @inheritdoc ICrossChainTrustSync
    function requestSync(uint32 dstEid, bytes32 didHash, uint256 trustScore)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (trustScore > MAX_TRUST_SCORE) revert InvalidTrustScore();
        if (peers[dstEid] == bytes32(0)) revert PeerNotSet();

        // In a real implementation, this would call the LayerZero endpoint
        // For now, just emit the event for tracking
        emit TrustSyncRequested(didHash, dstEid, trustScore);

        // Note: Full implementation would look like:
        // bytes memory message = encodeTrustSyncMessage(didHash, trustScore, block.timestamp);
        // MessagingFee memory fee = _quote(dstEid, message, options, false);
        // if (msg.value < fee.nativeFee) revert InsufficientFee();
        // _lzSend(dstEid, message, options, fee, msg.sender);
    }

    /// @inheritdoc ICrossChainTrustSync
    function cacheTrustScore(bytes32 didHash, uint256 trustScore, uint256 timestamp)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (trustScore > MAX_TRUST_SCORE) revert InvalidTrustScore();

        _trustCache[didHash] = CachedTrustScore({
            trustScore: trustScore,
            timestamp: timestamp,
            srcEid: 0, // Local cache
            exists: true
        });
    }

    /// @inheritdoc ICrossChainTrustSync
    function batchCacheTrustScores(
        bytes32[] calldata didHashes,
        uint256[] calldata trustScores,
        uint256[] calldata timestamps
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (didHashes.length != trustScores.length || didHashes.length != timestamps.length) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < didHashes.length; i++) {
            if (trustScores[i] > MAX_TRUST_SCORE) revert InvalidTrustScore();

            _trustCache[didHashes[i]] =
                CachedTrustScore({ trustScore: trustScores[i], timestamp: timestamps[i], srcEid: 0, exists: true });
        }
    }

    // ============ Internal LayerZero Functions ============

    /// @notice Handle incoming message from LayerZero
    /// @dev This would be called by _lzReceive in the OApp pattern
    /// @param srcEid Source endpoint ID
    /// @param message Encoded message
    function _handleTrustSync(uint32 srcEid, bytes calldata message) internal {
        (uint8 msgType, bytes32 didHash, uint256 trustScore, uint256 timestamp) = decodeTrustSyncMessage(message);

        if (msgType == MSG_TYPE_TRUST_SYNC) {
            _trustCache[didHash] =
                CachedTrustScore({ trustScore: trustScore, timestamp: timestamp, srcEid: srcEid, exists: true });

            emit TrustSyncReceived(didHash, srcEid, trustScore);
        }
    }

    // ============ Message Encoding/Decoding ============

    /// @notice Encode a trust sync message
    /// @param didHash Agent DID hash
    /// @param trustScore Trust score
    /// @param timestamp Timestamp
    /// @return Encoded message
    function encodeTrustSyncMessage(bytes32 didHash, uint256 trustScore, uint256 timestamp)
        public
        pure
        returns (bytes memory)
    {
        return abi.encode(MSG_TYPE_TRUST_SYNC, didHash, trustScore, timestamp);
    }

    /// @notice Decode a trust sync message
    /// @param message Encoded message
    /// @return msgType Message type
    /// @return didHash Agent DID hash
    /// @return trustScore Trust score
    /// @return timestamp Timestamp
    function decodeTrustSyncMessage(bytes memory message)
        public
        pure
        returns (uint8 msgType, bytes32 didHash, uint256 trustScore, uint256 timestamp)
    {
        (msgType, didHash, trustScore, timestamp) = abi.decode(message, (uint8, bytes32, uint256, uint256));
    }

    // ============ Query Functions ============

    /// @inheritdoc ICrossChainTrustSync
    function getCachedTrustScore(bytes32 didHash)
        external
        view
        override
        returns (uint256 trustScore, uint256 timestamp, bool exists)
    {
        CachedTrustScore storage cache = _trustCache[didHash];
        return (cache.trustScore, cache.timestamp, cache.exists);
    }

    /// @inheritdoc ICrossChainTrustSync
    function getAggregatedTrustScore(bytes32 didHash) external view override returns (uint256) {
        CachedTrustScore storage cache = _trustCache[didHash];
        if (!cache.exists) {
            return 0;
        }
        // Simple implementation: return cached score
        // A more complex implementation would aggregate across multiple sources
        return cache.trustScore;
    }

    /// @inheritdoc ICrossChainTrustSync
    function isCacheStale(bytes32 didHash) external view override returns (bool) {
        CachedTrustScore storage cache = _trustCache[didHash];
        if (!cache.exists) {
            return true;
        }
        return block.timestamp > cache.timestamp + cacheTTL;
    }

    /// @inheritdoc ICrossChainTrustSync
    function quoteSyncFee(uint32 dstEid, bytes32 didHash, uint256 trustScore)
        external
        view
        override
        returns (uint256 nativeFee)
    {
        // In a real implementation, this would query the LayerZero endpoint
        // For now, return 0 as a placeholder
        // Note: Full implementation would use _quote from OApp
        if (peers[dstEid] == bytes32(0)) return 0;

        // Placeholder: estimate based on message size
        bytes memory message = encodeTrustSyncMessage(didHash, trustScore, block.timestamp);
        nativeFee = message.length * 1 gwei; // Rough estimate
    }

    // ============ View Functions ============

    /// @inheritdoc ICrossChainTrustSync
    function isPrimaryChain() external view override returns (bool) {
        return primaryChainId != 0 && primaryChainId == block.chainid;
    }

    /// @inheritdoc ICrossChainTrustSync
    function getSupportedDestinations() external view override returns (uint32[] memory) {
        // Count peers with non-zero addresses
        uint256 count = 0;
        for (uint256 i = 0; i < _peerEids.length; i++) {
            if (peers[_peerEids[i]] != bytes32(0)) {
                count++;
            }
        }

        // Build result array
        uint32[] memory result = new uint32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < _peerEids.length; i++) {
            if (peers[_peerEids[i]] != bytes32(0)) {
                result[index] = _peerEids[i];
                index++;
            }
        }

        return result;
    }
}
