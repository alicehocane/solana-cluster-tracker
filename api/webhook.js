import { createClient } from '@supabase/supabase-js';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1545746746242498620/LjsCpbblr-07w1Gi9GcQrTn39MspeX6sn8lnTbkvcFEJKKjG0x_gFS1QcYlD1eago97-";

// Initialize Supabase Client
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const TRACKED_WALLETS = new Set([
    "9oKGw6n6tjGC7mGuS4PLRYx1xSMt2pAzFdCibUjdaX2m",
    "3VMW45SQTeSxFrSozjBbx49qqQ2z6HKUezvakAPwHwhz",
    "GkVZ6BRP3nd8LYwCAdniVdTS2R8zniRbkN5tZhhvLBtY",
    "5cQM6QHmdLPS8AEKA8KtszFmC8Rq4YrDj9WpWDtXTqSy",
    "7UDarSsvMu64SDyL5dayANca8za87tbyeuAdGjMKWf16",
    "EHg5YkU2SZBTvuT87rUsvxArGp3HLeye1fXaSDfuMyaf",
    "BgpLrxjCPFrvqEUQNrMxhP7ZmDNbjwcaX8fzy3ZuYvzT",
    "BQdbTPv9iuPjU6swSVJEsdv3hutS1UxFstTpx4KRVZEm",
    "3Qchg1ipMKRoqDktu27yNMvcPe3xTHD9q7uJe6Xtbua2",
    "4w8St7tNUNqgAXvXd4BjhkByV1w9vagp2yjUyrnoU4ZS",
    "Ggnm2KVizsXedUrBJqjXtg8ztgCw3C5P6swVfSiFQ2SH",
    "8eGqytw6HWhykdBoA9gNWZv7t7vYr6X8KeoDABU1731y",
    "3bwkvwoYnyC9GMVFn2EWeAJ2YptCnZDWdc284SdWD2gd",
    "3pLheGVtmHLe5xDpVXWLLPmcKquNLTGMEmzTofxLmoCC",
    "8mNGKZAsSwgmhrkVnvhmcuSDW3Bt5s1GSS7uzd93DcmV",
    "BHREKFkPQgAtDs8Vb1UfLkUpjG6ScidTjHaCWFuG2AtX",
    "Hj7UJq2DFqYdPv7JZzWWiRcNG36vD8knmWbggBfXNc51",
    "ALaYhQti7bcSb1MNFjkz4TPTeHKCvdCy3ivN8tmQdh35",
    "5xwjQ3s8jytQ4nBYnBbzM34xSGWtjRAy8dwn9vPKtGNS",
    "E8tXebsK9bKkr44YSkfnmmWftGzcFZboHJcVMt3Kis4w",
    "CTnhDdpKCdRBNXocZgGh4aeM1vxTSsXLT68CTAZLUzWD",
    "ETRwCdhkKYQk6HK58zGAd8aEEpTQuMUBwXhEfG9v2Jb3",
    "CnjMc5DeNmhPSYZ2xFpNqtKGuU8ETTKHqUQwicapboDj",
    "L2vRhKZsQcRUHvy1PEY4dCJ37XhfqHzgRrgAgfs4FFN",
    "ETwAcPeN87KmFm8xPBsSiQCuqnyLgLdU9qevbf5t8KLn"
]);

const BLACKLISTED_TOKENS = new Set([
    "So11111111111111111111111111111111111111112", // Wrapped SOL
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

const MIN_SOL_SPEND = 0.05; 
const HOLDING_CHECK_MS = 3 * 60 * 1000;

async function sendDiscordAlert(message) {
    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message })
        });
    } catch (error) {
        console.error("Failed to send Discord notification:", error);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const transactions = req.body;
        if (!Array.isArray(transactions)) {
            return res.status(400).json({ error: 'Invalid payload format' });
        }

        const now = Date.now();

        for (const tx of transactions) {
            if (tx.type !== 'SWAP') continue;

            const targetAccount = tx.accountData?.find(acc => 
                TRACKED_WALLETS.has(acc.account)
            );

            if (!targetAccount) continue;
            const involvedTrackedWallet = targetAccount.account;

            const tokenTransfer = tx.tokenTransfers?.find(transfer => 
                transfer.toUserAccount === involvedTrackedWallet || transfer.fromUserAccount === involvedTrackedWallet
            );

            if (!tokenTransfer) continue;
            const tokenMint = tokenTransfer.mint;
            if (BLACKLISTED_TOKENS.has(tokenMint)) continue;

            const isBuy = tokenTransfer.toUserAccount === involvedTrackedWallet;
            const isSell = tokenTransfer.fromUserAccount === involvedTrackedWallet;

            if (isSell) {
                await supabase
                    .from('tracked_pending_buys')
                    .update({ status: 'cancelled' })
                    .eq('wallet', involvedTrackedWallet)
                    .eq('token_mint', tokenMint)
                    .in('status', ['pending', 'verified']);
                continue;
            }

            if (isBuy) {
                const solSpent = Math.abs(targetAccount.nativeBalanceChange) / 1e9;
                if (solSpent < MIN_SOL_SPEND) continue;

                await supabase.from('tracked_pending_buys').insert([
                    {
                        wallet: involvedTrackedWallet,
                        token_mint: tokenMint,
                        buy_timestamp: now,
                        sol_spent: solSpent,
                        status: 'pending'
                    }
                ]);
            }
        }

        const threeMinutesAgo = now - HOLDING_CHECK_MS;
        
        const { data: matureBuys, error } = await supabase
            .from('tracked_pending_buys')
            .select('*')
            .eq('status', 'pending')
            .lte('buy_timestamp', threeMinutesAgo);

        if (!error && matureBuys && matureBuys.length > 0) {
            const uniqueTokens = [...new Set(matureBuys.map(b => b.token_mint))];

            for (const tokenMint of uniqueTokens) {
                const baseBuy = matureBuys.find(b => b.token_mint === tokenMint);
                const thirtyMinsBefore = baseBuy.buy_timestamp - (30 * 60 * 1000);
                const thirtyMinsAfter = baseBuy.buy_timestamp + (30 * 60 * 1000);

                const { data: clusterData } = await supabase
                    .from('tracked_pending_buys')
                    .select('wallet, sol_spent, buy_timestamp')
                    .eq('token_mint', tokenMint)
                    .in('status', ['pending', 'verified'])
                    .gte('buy_timestamp', thirtyMinsBefore)
                    .lte('buy_timestamp', thirtyMinsAfter)
                    .order('buy_timestamp', { ascending: true });

                if (!clusterData || clusterData.length === 0) continue;

                await supabase
                    .from('tracked_pending_buys')
                    .update({ status: 'notified' })
                    .eq('token_mint', tokenMint)
                    .eq('status', 'pending');

                const uniqueBuyersMap = new Map();
                clusterData.forEach(item => {
                    if (!uniqueBuyersMap.has(item.wallet)) {
                        uniqueBuyersMap.set(item.wallet, item.sol_spent);
                    }
                });

                const buyerEntries = Array.from(uniqueBuyersMap.entries());
                const primaryBuyerWallet = buyerEntries[0][0];
                
                // Display full wallet address enclosed in code blocks (``) so it's easily copyable
                const formattedBuyersString = buyerEntries
                    .map(([wallet, spent]) => `\`${wallet}\` (Spent ~${Number(spent).toFixed(2)} SOL)`)
                    .join(', ');

                const shortToken = `${tokenMint.slice(0, 4)}...${tokenMint.slice(-4)}`;
                let probabilityScore = buyerEntries.length >= 3 ? "🔥 HIGH PUMP PROBABILITY 🔥" : "⚡ Medium ⚡";

                const message = 
                    `🚨 **CONFLUENCE ALERT (3-Min Hold Verified)** 🚨\n\n` +
                    `🪙 **Token:** \`${shortToken}\`\n` +
                    `👤 **Buyer(s):** ${formattedBuyersString}\n` +
                    `👥 **Cluster Activity:** **${buyerEntries.length} tracked wallet(s)** held this past 3 mins.\n` +
                    `📊 **Status:** ${probabilityScore}\n\n` +
                    `🔗 [Dexscreener](https://dexscreener.com/solana/${tokenMint}?maker=${primaryBuyerWallet}) | [Solscan](https://solscan.io/token/${tokenMint})`;

                await sendDiscordAlert(message);
            }
        }

        return res.status(200).json({ status: 'received', processed: true });

    } catch (err) {
        console.error("Error processing transaction batch:", err);
        return res.status(500).json({ error: err.message });
    }
}