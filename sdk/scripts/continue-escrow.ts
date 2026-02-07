import { createPublicClient, createWalletClient, http, parseUnits, keccak256, toHex, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const ESCROW = '0xBb2f0Eb0f064b62E2116fd79C12dA1dcEb58B695';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY environment variable required');
  process.exit(1);
}
const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY as `0x${string}`;
if (!CLIENT_PRIVATE_KEY) {
  console.error('CLIENT_PRIVATE_KEY environment variable required');
  process.exit(1);
}

const usdcAbi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const;

const escrowAbi = [
  { name: 'fundEscrow', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'uint256' }], outputs: [] },
  { name: 'confirmDelivery', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'outputHash', type: 'bytes32' }], outputs: [] },
  { name: 'releaseEscrow', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'uint256' }], outputs: [] },
  { name: 'getEscrow', type: 'function', stateMutability: 'view', inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'id', type: 'uint256' }, { name: 'clientDid', type: 'bytes32' }, { name: 'providerDid', type: 'bytes32' },
      { name: 'clientAddress', type: 'address' }, { name: 'providerAddress', type: 'address' },
      { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'taskHash', type: 'bytes32' },
      { name: 'status', type: 'uint8' }, { name: 'createdAt', type: 'uint256' }, { name: 'completedAt', type: 'uint256' }, { name: 'deadline', type: 'uint256' }
    ]}]
  }
] as const;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const providerAccount = privateKeyToAccount(PRIVATE_KEY);
  const clientAccount = privateKeyToAccount(CLIENT_PRIVATE_KEY);
  
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });
  const providerWallet = createWalletClient({ account: providerAccount, chain: baseSepolia, transport: http('https://sepolia.base.org') });
  const clientWallet = createWalletClient({ account: clientAccount, chain: baseSepolia, transport: http('https://sepolia.base.org') });

  const escrowId = 2n;
  const paymentAmount = parseUnits('1', 6);
  const outputHash = keccak256(toHex('Code review complete: No critical issues found'));
  const statusMap = ['Created', 'Funded', 'Delivered', 'Completed', 'Disputed', 'Refunded', 'Cancelled'];

  console.log('━━━ Continuing Escrow #2 ━━━\n');

  // Check current state
  const escrow = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'getEscrow', args: [escrowId] });
  console.log('Current status:', statusMap[escrow.status]);
  console.log('Amount:', formatUnits(escrow.amount, 6), 'USDC');

  const providerBefore = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [providerAccount.address] });
  const clientBefore = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [clientAccount.address] });

  if (escrow.status === 0) { // Created - need to fund
    console.log('\n━━━ STEP 3: Fund Escrow ━━━');
    console.log('   Approving USDC...');
    await sleep(3000); // Wait for nonce to sync
    const approveHash = await clientWallet.writeContract({ address: USDC, abi: usdcAbi, functionName: 'approve', args: [ESCROW, paymentAmount] });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('   ✅ Approved');
    
    console.log('   Funding escrow...');
    await sleep(2000);
    const fundHash = await clientWallet.writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'fundEscrow', args: [escrowId] });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log('   ✅ Funded!');
  }

  const escrow2 = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'getEscrow', args: [escrowId] });
  console.log('\nStatus after fund:', statusMap[escrow2.status]);

  if (escrow2.status === 1) { // Funded - provider confirms delivery
    console.log('\n━━━ STEP 4: Provider Works ━━━');
    console.log('   ⏳ Performing code review...');
    await sleep(2000);
    console.log('   ✅ Work complete!');

    console.log('\n━━━ STEP 5: Confirm Delivery ━━━');
    const confirmHash = await providerWallet.writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'confirmDelivery', args: [escrowId, outputHash] });
    await publicClient.waitForTransactionReceipt({ hash: confirmHash });
    console.log('   ✅ Delivery confirmed!');
  }

  const escrow3 = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'getEscrow', args: [escrowId] });
  console.log('\nStatus after confirm:', statusMap[escrow3.status]);

  if (escrow3.status === 2) { // Delivered - client releases
    console.log('\n━━━ STEP 6: Release Payment ━━━');
    await sleep(2000);
    const releaseHash = await clientWallet.writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'releaseEscrow', args: [escrowId] });
    await publicClient.waitForTransactionReceipt({ hash: releaseHash });
    console.log('   ✅ Payment released!');
    console.log('   TX: https://sepolia.basescan.org/tx/' + releaseHash);
  }

  // Final
  console.log('\n━━━ FINAL BALANCES ━━━');
  const providerAfter = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [providerAccount.address] });
  const clientAfter = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [clientAccount.address] });
  console.log('Provider:', formatUnits(providerBefore, 6), '→', formatUnits(providerAfter, 6), 'USDC');
  console.log('Client:', formatUnits(clientBefore, 6), '→', formatUnits(clientAfter, 6), 'USDC');
  
  if (providerAfter > providerBefore) {
    console.log('\n🎉 Provider earned: +' + formatUnits(providerAfter - providerBefore, 6), 'USDC');
  }
}

main().catch(e => console.error('❌ Error:', e.shortMessage || e.message));
