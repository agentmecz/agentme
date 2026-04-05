// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";
import "../src/TrustRegistry.sol";
import "../src/AgoraMeshEscrow.sol";
import "../src/ChainRegistry.sol";
import "../src/MockUSDC.sol";

/// @title TimelockAdmin Integration Tests
/// @notice Tests the full lifecycle: deploy timelock, transfer admin, schedule → wait → execute
contract TimelockAdminTest is Test {
    TimelockController public timelock;
    TrustRegistry public trustRegistry;
    AgoraMeshEscrow public escrow;
    ChainRegistry public chainRegistry;
    MockUSDC public usdc;

    address public deployer = makeAddr("deployer");
    address public newTreasury = makeAddr("newTreasury");

    uint256 constant MIN_DELAY = 24 hours;
    bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy mock USDC
        usdc = new MockUSDC();

        // Deploy contracts with deployer as admin
        trustRegistry = new TrustRegistry(address(usdc), deployer);
        escrow = new AgoraMeshEscrow(address(trustRegistry), deployer);
        chainRegistry = new ChainRegistry(deployer);

        // Deploy TimelockController
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = deployer;

        timelock = new TimelockController(MIN_DELAY, proposers, executors, deployer);

        // Grant DEFAULT_ADMIN_ROLE to timelock on each contract
        trustRegistry.grantRole(DEFAULT_ADMIN_ROLE, address(timelock));
        escrow.grantRole(DEFAULT_ADMIN_ROLE, address(timelock));
        chainRegistry.grantRole(DEFAULT_ADMIN_ROLE, address(timelock));

        // Revoke deployer's DEFAULT_ADMIN_ROLE
        trustRegistry.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        escrow.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        chainRegistry.revokeRole(DEFAULT_ADMIN_ROLE, deployer);

        vm.stopPrank();
    }

    // ============ Setup Verification ============

    function test_timelockHasAdminRole() public {
        assertTrue(trustRegistry.hasRole(DEFAULT_ADMIN_ROLE, address(timelock)));
        assertTrue(escrow.hasRole(DEFAULT_ADMIN_ROLE, address(timelock)));
        assertTrue(chainRegistry.hasRole(DEFAULT_ADMIN_ROLE, address(timelock)));
    }

    function test_deployerLostAdminRole() public {
        assertFalse(trustRegistry.hasRole(DEFAULT_ADMIN_ROLE, deployer));
        assertFalse(escrow.hasRole(DEFAULT_ADMIN_ROLE, deployer));
        assertFalse(chainRegistry.hasRole(DEFAULT_ADMIN_ROLE, deployer));
    }

    function test_deployerHasTimelockRoles() public {
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), deployer));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), deployer));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), deployer));
    }

    function test_timelockMinDelay() public {
        assertEq(timelock.getMinDelay(), MIN_DELAY);
    }

    // ============ Direct Admin Calls Should Fail ============

    function test_directAdminCallReverts() public {
        vm.prank(deployer);
        vm.expectRevert();
        escrow.setTreasury(newTreasury);
    }

    // ============ Full Timelock Lifecycle ============

    function test_scheduleWaitExecute_setTreasury() public {
        // Encode the admin call: escrow.setTreasury(newTreasury)
        address target = address(escrow);
        uint256 value = 0;
        bytes memory data = abi.encodeCall(AgoraMeshEscrow.setTreasury, (newTreasury));
        bytes32 predecessor = bytes32(0);
        bytes32 salt = keccak256("setTreasury-1");

        // Step 1: Schedule the operation
        vm.prank(deployer);
        timelock.schedule(target, value, data, predecessor, salt, MIN_DELAY);

        bytes32 opId = timelock.hashOperation(target, value, data, predecessor, salt);
        assertTrue(timelock.isOperationPending(opId));
        assertFalse(timelock.isOperationReady(opId));

        // Step 2: Try to execute before delay — should fail
        vm.prank(deployer);
        vm.expectRevert();
        timelock.execute(target, value, data, predecessor, salt);

        // Step 3: Wait for the delay
        vm.warp(block.timestamp + MIN_DELAY);
        assertTrue(timelock.isOperationReady(opId));

        // Step 4: Execute
        vm.prank(deployer);
        timelock.execute(target, value, data, predecessor, salt);

        assertTrue(timelock.isOperationDone(opId));

        // Step 5: Verify the effect
        assertEq(escrow.treasury(), newTreasury);
    }

    function test_scheduleWaitExecute_grantRole() public {
        // Schedule granting ORACLE_ROLE to a new address via timelock
        address newOracle = makeAddr("newOracle");
        bytes32 oracleRole = trustRegistry.ORACLE_ROLE();

        address target = address(trustRegistry);
        uint256 value = 0;
        bytes memory data = abi.encodeCall(
            IAccessControl.grantRole, (oracleRole, newOracle)
        );
        bytes32 predecessor = bytes32(0);
        bytes32 salt = keccak256("grantOracle-1");

        vm.prank(deployer);
        timelock.schedule(target, value, data, predecessor, salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        vm.prank(deployer);
        timelock.execute(target, value, data, predecessor, salt);

        assertTrue(trustRegistry.hasRole(oracleRole, newOracle));
    }

    function test_cancelScheduledOperation() public {
        address target = address(escrow);
        uint256 value = 0;
        bytes memory data = abi.encodeCall(AgoraMeshEscrow.setTreasury, (newTreasury));
        bytes32 predecessor = bytes32(0);
        bytes32 salt = keccak256("cancel-test");

        // Schedule
        vm.prank(deployer);
        timelock.schedule(target, value, data, predecessor, salt, MIN_DELAY);

        bytes32 opId = timelock.hashOperation(target, value, data, predecessor, salt);
        assertTrue(timelock.isOperationPending(opId));

        // Cancel using CANCELLER_ROLE
        vm.prank(deployer);
        timelock.cancel(opId);

        assertFalse(timelock.isOperationPending(opId));

        // Verify it can't be executed after delay
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(deployer);
        vm.expectRevert();
        timelock.execute(target, value, data, predecessor, salt);
    }

    function test_executeBatchOperation() public {
        // Schedule a batch: set treasury on escrow AND add a chain to registry
        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory payloads = new bytes[](2);

        targets[0] = address(escrow);
        values[0] = 0;
        payloads[0] = abi.encodeCall(AgoraMeshEscrow.setTreasury, (newTreasury));

        targets[1] = address(chainRegistry);
        values[1] = 0;
        payloads[1] = abi.encodeCall(ChainRegistry.addChain, (84532, "Base Sepolia", true));

        bytes32 predecessor = bytes32(0);
        bytes32 salt = keccak256("batch-1");

        vm.prank(deployer);
        timelock.scheduleBatch(targets, values, payloads, predecessor, salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        vm.prank(deployer);
        timelock.executeBatch(targets, values, payloads, predecessor, salt);

        assertEq(escrow.treasury(), newTreasury);
        (,string memory name,,) = chainRegistry.getChain(84532);
        assertEq(name, "Base Sepolia");
    }

    function test_unauthorizedProposerReverts() public {
        address attacker = makeAddr("attacker");

        address target = address(escrow);
        uint256 value = 0;
        bytes memory data = abi.encodeCall(AgoraMeshEscrow.setTreasury, (attacker));
        bytes32 predecessor = bytes32(0);
        bytes32 salt = keccak256("attack-1");

        vm.prank(attacker);
        vm.expectRevert();
        timelock.schedule(target, value, data, predecessor, salt, MIN_DELAY);
    }

    function test_unauthorizedExecutorReverts() public {
        address attacker = makeAddr("attacker");

        address target = address(escrow);
        uint256 value = 0;
        bytes memory data = abi.encodeCall(AgoraMeshEscrow.setTreasury, (newTreasury));
        bytes32 predecessor = bytes32(0);
        bytes32 salt = keccak256("unauth-exec-1");

        // Deployer schedules
        vm.prank(deployer);
        timelock.schedule(target, value, data, predecessor, salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        // Attacker tries to execute
        vm.prank(attacker);
        vm.expectRevert();
        timelock.execute(target, value, data, predecessor, salt);
    }
}
