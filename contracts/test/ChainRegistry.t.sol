// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChainRegistry.sol";

/// @title ChainRegistry Tests
/// @notice TDD tests for the ChainRegistry contract
contract ChainRegistryTest is Test {
    ChainRegistry public registry;

    address public admin = address(0x1);
    address public user = address(0x2);

    // Chain IDs
    uint64 public constant BASE_MAINNET = 8453;
    uint64 public constant BASE_SEPOLIA = 84532;
    uint64 public constant POLYGON_MAINNET = 137;
    uint64 public constant ARBITRUM_MAINNET = 42161;
    uint64 public constant OPTIMISM_MAINNET = 10;

    // Events
    event ChainAdded(uint64 indexed chainId, string name, bool isTestnet);
    event ChainRemoved(uint64 indexed chainId);
    event ChainUpdated(uint64 indexed chainId);
    event TrustRegistrySet(uint64 indexed chainId, address trustRegistry);
    event USDCAddressSet(uint64 indexed chainId, address usdcAddress);
    event EndpointSet(uint64 indexed chainId, address endpoint);

    function setUp() public {
        vm.startPrank(admin);
        registry = new ChainRegistry(admin);
        vm.stopPrank();
    }

    // ============ Constructor Tests ============

    function test_Constructor_SetsAdmin() public {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_Constructor_RevertsIfAdminIsZero() public {
        vm.expectRevert(ChainRegistry.InvalidAdmin.selector);
        new ChainRegistry(address(0));
    }

    // ============ Add Chain Tests ============

    function test_AddChain_Success() public {
        vm.startPrank(admin);

        vm.expectEmit(true, true, false, true);
        emit ChainAdded(BASE_MAINNET, "Base", false);

        registry.addChain(BASE_MAINNET, "Base", false);

        (uint64 chainId, string memory name, bool isTestnet, bool isActive) = registry.getChain(BASE_MAINNET);
        assertEq(chainId, BASE_MAINNET);
        assertEq(name, "Base");
        assertFalse(isTestnet);
        assertTrue(isActive);

        vm.stopPrank();
    }

    function test_AddChain_Testnet() public {
        vm.startPrank(admin);

        registry.addChain(BASE_SEPOLIA, "Base Sepolia", true);

        (,, bool isTestnet,) = registry.getChain(BASE_SEPOLIA);
        assertTrue(isTestnet);

        vm.stopPrank();
    }

    function test_AddChain_RevertsIfNotAdmin() public {
        vm.startPrank(user);

        vm.expectRevert();
        registry.addChain(BASE_MAINNET, "Base", false);

        vm.stopPrank();
    }

    function test_AddChain_RevertsIfAlreadyExists() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);

        vm.expectRevert(ChainRegistry.ChainAlreadyExists.selector);
        registry.addChain(BASE_MAINNET, "Base Duplicate", false);

        vm.stopPrank();
    }

    function test_AddChain_RevertsIfNameEmpty() public {
        vm.startPrank(admin);

        vm.expectRevert(ChainRegistry.InvalidChainName.selector);
        registry.addChain(BASE_MAINNET, "", false);

        vm.stopPrank();
    }

    // ============ Remove Chain Tests ============

    function test_RemoveChain_Success() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);

        vm.expectEmit(true, false, false, false);
        emit ChainRemoved(BASE_MAINNET);

        registry.removeChain(BASE_MAINNET);

        (uint64 chainId,,, bool isActive) = registry.getChain(BASE_MAINNET);
        assertEq(chainId, 0);
        assertFalse(isActive);

        vm.stopPrank();
    }

    function test_RemoveChain_RevertsIfNotAdmin() public {
        vm.startPrank(admin);
        registry.addChain(BASE_MAINNET, "Base", false);
        vm.stopPrank();

        vm.startPrank(user);
        vm.expectRevert();
        registry.removeChain(BASE_MAINNET);
        vm.stopPrank();
    }

    function test_RemoveChain_RevertsIfNotExists() public {
        vm.startPrank(admin);

        vm.expectRevert(ChainRegistry.ChainNotFound.selector);
        registry.removeChain(BASE_MAINNET);

        vm.stopPrank();
    }

    // ============ Set Trust Registry Tests ============

    function test_SetTrustRegistry_Success() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        address trustRegistry = address(0x123);

        vm.expectEmit(true, false, false, true);
        emit TrustRegistrySet(BASE_MAINNET, trustRegistry);

        registry.setTrustRegistry(BASE_MAINNET, trustRegistry);

        assertEq(registry.getTrustRegistry(BASE_MAINNET), trustRegistry);

        vm.stopPrank();
    }

    function test_SetTrustRegistry_RevertsIfChainNotFound() public {
        vm.startPrank(admin);

        vm.expectRevert(ChainRegistry.ChainNotFound.selector);
        registry.setTrustRegistry(BASE_MAINNET, address(0x123));

        vm.stopPrank();
    }

    function test_SetTrustRegistry_RevertsIfZeroAddress() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);

        vm.expectRevert(ChainRegistry.InvalidAddress.selector);
        registry.setTrustRegistry(BASE_MAINNET, address(0));

        vm.stopPrank();
    }

    // ============ Set USDC Address Tests ============

    function test_SetUSDCAddress_Success() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        address usdc = address(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);

        vm.expectEmit(true, false, false, true);
        emit USDCAddressSet(BASE_MAINNET, usdc);

        registry.setUSDCAddress(BASE_MAINNET, usdc);

        assertEq(registry.getUSDCAddress(BASE_MAINNET), usdc);

        vm.stopPrank();
    }

    function test_SetUSDCAddress_RevertsIfChainNotFound() public {
        vm.startPrank(admin);

        vm.expectRevert(ChainRegistry.ChainNotFound.selector);
        registry.setUSDCAddress(BASE_MAINNET, address(0x123));

        vm.stopPrank();
    }

    // ============ Set Endpoint Tests ============

    function test_SetEndpoint_Success() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        address endpoint = address(0x456);

        vm.expectEmit(true, false, false, true);
        emit EndpointSet(BASE_MAINNET, endpoint);

        registry.setEndpoint(BASE_MAINNET, endpoint);

        assertEq(registry.getEndpoint(BASE_MAINNET), endpoint);

        vm.stopPrank();
    }

    // ============ Get All Chains Tests ============

    function test_GetAllChains_Empty() public {
        uint64[] memory chains = registry.getAllChains();
        assertEq(chains.length, 0);
    }

    function test_GetAllChains_MultipleChains() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        registry.addChain(POLYGON_MAINNET, "Polygon", false);
        registry.addChain(ARBITRUM_MAINNET, "Arbitrum", false);

        uint64[] memory chains = registry.getAllChains();
        assertEq(chains.length, 3);

        vm.stopPrank();
    }

    function test_GetAllChains_AfterRemoval() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        registry.addChain(POLYGON_MAINNET, "Polygon", false);
        registry.removeChain(BASE_MAINNET);

        uint64[] memory chains = registry.getAllChains();
        assertEq(chains.length, 1);
        assertEq(chains[0], POLYGON_MAINNET);

        vm.stopPrank();
    }

    // ============ Get Active Chains Tests ============

    function test_GetActiveChains_OnlyActive() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        registry.addChain(POLYGON_MAINNET, "Polygon", false);
        registry.deactivateChain(BASE_MAINNET);

        uint64[] memory activeChains = registry.getActiveChains();
        assertEq(activeChains.length, 1);
        assertEq(activeChains[0], POLYGON_MAINNET);

        vm.stopPrank();
    }

    // ============ Deactivate/Activate Tests ============

    function test_DeactivateChain_Success() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        registry.deactivateChain(BASE_MAINNET);

        (,,, bool isActive) = registry.getChain(BASE_MAINNET);
        assertFalse(isActive);

        vm.stopPrank();
    }

    function test_ActivateChain_Success() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        registry.deactivateChain(BASE_MAINNET);
        registry.activateChain(BASE_MAINNET);

        (,,, bool isActive) = registry.getChain(BASE_MAINNET);
        assertTrue(isActive);

        vm.stopPrank();
    }

    // ============ Is Chain Supported Tests ============

    function test_IsChainSupported_True() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);

        assertTrue(registry.isChainSupported(BASE_MAINNET));

        vm.stopPrank();
    }

    function test_IsChainSupported_FalseNotAdded() public {
        assertFalse(registry.isChainSupported(BASE_MAINNET));
    }

    function test_IsChainSupported_FalseAfterRemoval() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        registry.removeChain(BASE_MAINNET);

        assertFalse(registry.isChainSupported(BASE_MAINNET));

        vm.stopPrank();
    }

    // ============ Get Testnets / Mainnets Tests ============

    function test_GetTestnets_OnlyTestnets() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        registry.addChain(BASE_SEPOLIA, "Base Sepolia", true);
        registry.addChain(POLYGON_MAINNET, "Polygon", false);

        uint64[] memory testnets = registry.getTestnets();
        assertEq(testnets.length, 1);
        assertEq(testnets[0], BASE_SEPOLIA);

        vm.stopPrank();
    }

    function test_GetMainnets_OnlyMainnets() public {
        vm.startPrank(admin);

        registry.addChain(BASE_MAINNET, "Base", false);
        registry.addChain(BASE_SEPOLIA, "Base Sepolia", true);
        registry.addChain(POLYGON_MAINNET, "Polygon", false);

        uint64[] memory mainnets = registry.getMainnets();
        assertEq(mainnets.length, 2);

        vm.stopPrank();
    }

    // ============ Chain Count Tests ============

    function test_ChainCount() public {
        vm.startPrank(admin);

        assertEq(registry.chainCount(), 0);

        registry.addChain(BASE_MAINNET, "Base", false);
        assertEq(registry.chainCount(), 1);

        registry.addChain(POLYGON_MAINNET, "Polygon", false);
        assertEq(registry.chainCount(), 2);

        registry.removeChain(BASE_MAINNET);
        assertEq(registry.chainCount(), 1);

        vm.stopPrank();
    }
}
