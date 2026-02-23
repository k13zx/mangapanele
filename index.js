require('dotenv').config();
const { Client, GatewayIntentBits, WebhookClient, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Tappytoon Otonom Takip Botu
 * Mimari: Hibrit (Puppeteer Token + Direct Fetch)
 * 
 * - Puppeteer sadece Bearer token almak için çalışır (1 kez)
 * - Sonraki istekler direct fetch ile yapılır (hızlı, ~1 sn)
 * - Token expire olursa (401) Puppeteer tekrar token alır
 * - Varyant filtresi: [Steamy]/[Uncut] sadece orijinali listede varsa çıkarılır
 */

const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN,
    CHANNEL_ID: process.env.CHANNEL_ID,
    WEBHOOK_URL: process.env.WEBHOOK_URL,
    MEMORY_FILE: path.join(__dirname, 'tappytoon_hafiza.json'),
    INTERVAL_MS: 15 * 60 * 1000,
    THEME_COLOR: '#FF4B55',
    PREFIX: 's!'
};

const API_URL = 'https://api-global.tappytoon.com/comics?excludes=wait_until_free_next_id&ageRatingInitials=E,M&filter=new_coming&includes=first_chapter,+video_clips&locale=en';

const TAPPYTOON = {
    PAGE_URL: 'https://www.tappytoon.com/en/comics/new',
    API_MATCH: 'api-global.tappytoon.com/comics'
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const webhook = new WebhookClient({ url: CONFIG.WEBHOOK_URL });

// ═══════════════════════════════════════════
//  Bearer Token Yönetimi
// ═══════════════════════════════════════════
let cachedBearerToken = null;
let lastPuppeteerData = null;

/**
 * Puppeteer ile Tappytoon'dan taze Bearer token yakalar.
 * Sadece token expire olduğunda çağrılır.
 */
async function refreshBearerToken() {
    let browser = null;

    try {
        console.log('[Token] Puppeteer ile yeni token alınıyor...');

        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        let capturedToken = null;
        let capturedData = null;

        // Response dinleyicisi — hem token hem veri yakala
        const dataPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('API yanıtı 45sn içinde yakalanamadı.')), 45000);

            page.on('response', async (response) => {
                const url = response.url();

                if (url.includes(TAPPYTOON.API_MATCH) && url.includes('new_coming')) {
                    try {
                        // Request header'larından token'ı al
                        const req = response.request();
                        const authHeader = req.headers()['authorization'];
                        if (authHeader) {
                            capturedToken = authHeader;
                        }

                        // Response body'den veriyi al
                        const body = await response.json();
                        capturedData = Array.isArray(body) ? body : (body.data || body.comics || null);

                        clearTimeout(timeout);
                        resolve();
                    } catch (e) {
                        // JSON parse hatasını yoksay
                    }
                }
            });
        });

        await page.goto(TAPPYTOON.PAGE_URL, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => { });
        await dataPromise;

        if (capturedToken) {
            cachedBearerToken = capturedToken;
            console.log(`[Token] Token yakalandı: ${capturedToken.substring(0, 20)}...`);
        }

        if (capturedData) {
            lastPuppeteerData = capturedData;
            console.log(`[Token] ${capturedData.length} seri veri olarak yakalandı.`);
        }

        return capturedToken;

    } catch (error) {
        console.error(`[Token Hatası] ${error.message}`);
        return null;
    } finally {
        if (browser) {
            await browser.close();
            console.log('[Token] Tarayıcı kapatıldı.');
        }
    }
}

// ═══════════════════════════════════════════
//  Direct Fetch ile Veri Çekme (Hızlı)
// ═══════════════════════════════════════════
async function fetchComics() {
    // Token yoksa Puppeteer ile al (aynı zamanda veriyi de yakalar)
    if (!cachedBearerToken) {
        await refreshBearerToken();

        // Puppeteer zaten veriyi yakaladıysa, direkt kullan
        if (lastPuppeteerData) {
            const data = lastPuppeteerData;
            lastPuppeteerData = null; // Bir kez kullan
            console.log('[Fetch] Puppeteer verisinden alındı (extra istek yok).');
            return data;
        }

        if (!cachedBearerToken) return null;
    }

    console.log('[Fetch] Direct API sorgusu yapılıyor...');

    const response = await fetch(API_URL, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Authorization': cachedBearerToken
        }
    });

    // Token expire olduysa yenile ve tekrar dene
    if (response.status === 401) {
        console.log('[Fetch] Token expire oldu (401). Yenileniyor...');
        await refreshBearerToken();
        if (!cachedBearerToken) return null;

        const retry = await fetch(API_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Authorization': cachedBearerToken
            }
        });

        if (!retry.ok) {
            console.error(`[Fetch] Yeniden deneme başarısız: ${retry.status}`);
            return null;
        }

        const json = await retry.json();
        console.log('[Fetch] Yenilenen token ile veri çekildi.');
        return Array.isArray(json) ? json : (json.data || json.comics || null);
    }

    if (!response.ok) {
        console.error(`[Fetch] API Hatası: ${response.status}`);
        return null;
    }

    const json = await response.json();
    console.log('[Fetch] Veri başarıyla çekildi. (~1 saniye)');
    return Array.isArray(json) ? json : (json.data || json.comics || null);
}

// ═══════════════════════════════════════════
//  JSON Hafıza Yönetimi
// ═══════════════════════════════════════════
const MemoryManager = {
    load: () => {
        if (!fs.existsSync(CONFIG.MEMORY_FILE)) return null;
        try {
            return JSON.parse(fs.readFileSync(CONFIG.MEMORY_FILE, 'utf8'));
        } catch (e) {
            return [];
        }
    },
    save: (data) => {
        fs.writeFileSync(CONFIG.MEMORY_FILE, JSON.stringify(data, null, 2));
    },
    getIds: (data) => {
        if (!data || !Array.isArray(data)) return [];
        if (typeof data[0] === 'string') return data;
        return data.map(d => d.id);
    }
};

// ═══════════════════════════════════════════
//  Varyant Filtresi
// ═══════════════════════════════════════════

/**
 * Orijinali listede olan varyantları çıkarır.
 * Orijinali yoksa varyantı tutar.
 */
function filterDuplicateVariants(comics) {
    if (!comics || !Array.isArray(comics)) return comics;

    const variantTags = [
        '[Uncut]', '[Steamy]', '[Spicy]', '[Mature]',
        '[Special Edition]', '[Extended]', '[Director\'s Cut]',
        '[XXX]', '[18+]', '[R-18]', '[Uncensored]'
    ];

    // Orijinal başlıkları topla
    const originalTitles = new Set();
    for (const c of comics) {
        const isVariant = variantTags.some(tag => c.title.includes(tag));
        if (!isVariant) {
            originalTitles.add(c.title.trim().toLowerCase());
        }
    }

    // Orijinali varsa varyantı çıkar, yoksa tut
    const filtered = comics.filter(c => {
        const isVariant = variantTags.some(tag => c.title.includes(tag));
        if (!isVariant) return true;

        let baseName = c.title;
        for (const tag of variantTags) {
            baseName = baseName.replace(tag, '').trim();
        }

        if (originalTitles.has(baseName.toLowerCase())) {
            console.log(`[Filtre] Varyant atlandı: "${c.title}" (orijinal mevcut)`);
            return false;
        }

        return true; // Orijinali yok, tut
    });

    const removed = comics.length - filtered.length;
    if (removed > 0) console.log(`[Filtre] ${removed} varyant filtrelendi.`);

    return filtered;
}

// ═══════════════════════════════════════════
//  Embed Oluşturucu
// ═══════════════════════════════════════════
function createDetailedEmbed(series, label = '🆕 Yeni Eklendi') {
    const genres = (series.genres || []).map(g => g.name).join(', ') || 'Bilinmiyor';
    const authors = (series.authors || []).map(a => a.name).join(', ') || 'Bilinmiyor';

    let description = series.synopsis || series.description || '';
    if (description.length > 150) description = description.substring(0, 147) + '...';

    const status = series.isCompleted ? '✅ Tamamlandı' : (series.isHiatus ? '⏸️ Ara' : '📖 Devam');

    const thumbUrl = series.images?.['cover/square']?.url || series.thumbnailUrl || null;

    const embed = new EmbedBuilder()
        .setTitle(series.title)
        .setURL(`https://www.tappytoon.com/en/comics/${series.id}`)
        .setColor(series.keyColor?.original || CONFIG.THEME_COLOR)
        .addFields(
            { name: '📚 Tür', value: genres, inline: true },
            { name: '✍️ Yazar', value: authors, inline: true },
            { name: '📖 Bölüm', value: `${series.totalChaptersCount || 0}`, inline: true },
            { name: '⭐ Puan', value: `${series.averageScore || 0}/10`, inline: true },
            { name: '📌 Durum', value: status, inline: true },
            { name: '🏷️', value: label, inline: true }
        )
        .setFooter({ text: 'Tappytoon Takip' })
        .setTimestamp();

    if (description) embed.setDescription(description);
    if (thumbUrl) embed.setThumbnail(thumbUrl);

    return embed;
}

// ═══════════════════════════════════════════
//  Webhook ile Mesaj Gönderme
// ═══════════════════════════════════════════
async function sendViaWebhook(embeds, content = null) {
    const payload = {
        username: 'Tappytoon Takip',
        avatarURL: 'https://static.tappytoon.com/assets/favicons/favicon-32x32.png'
    };

    if (content) payload.content = content;
    if (embeds && embeds.length > 0) payload.embeds = embeds;

    await webhook.send(payload);
}

// ═══════════════════════════════════════════
//  s!paylas — Manuel Paylaşım
// ═══════════════════════════════════════════
async function handlePaylas(message) {
    try {
        await message.reply('⏳ Tappytoon\'dan seriler çekiliyor...');

        const rawComics = await fetchComics();

        if (!rawComics || !Array.isArray(rawComics) || rawComics.length === 0) {
            await message.reply('❌ Veri çekilemedi.');
            return;
        }

        const comics = filterDuplicateVariants(rawComics);

        await sendViaWebhook([], `📚 **Tappytoon — Yeni Çıkan Seriler** (${comics.length} adet)`);

        // Sırayla tek tek gönder
        for (let i = 0; i < comics.length; i++) {
            const embed = createDetailedEmbed(comics[i], '📖 Mevcut Seri');
            await sendViaWebhook([embed]);

            // Her 5 mesajda 1 saniye bekle
            if ((i + 1) % 5 === 0 && i + 1 < comics.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        await sendViaWebhook([], `✅ Toplam **${comics.length}** seri listelendi.`);
        console.log(`[Komut] s!paylas — ${comics.length} seri paylaşıldı.`);

    } catch (error) {
        console.error(`[Komut Hatası] ${error.message}`);
        await message.reply('❌ Hata: ' + error.message);
    }
}

// ═══════════════════════════════════════════
//  Ana Kontrol Döngüsü (Otomatik)
// ═══════════════════════════════════════════
async function runAutoCheck() {
    try {
        console.log('─'.repeat(50));
        console.log('[Kontrol] Yeni döngü başlatılıyor...');

        const rawComics = await fetchComics();

        if (!rawComics || !Array.isArray(rawComics)) {
            console.log('[Sistem] Geçersiz veri döndü.');
            return;
        }

        const comics = filterDuplicateVariants(rawComics);
        console.log(`[Kontrol] ${comics.length} seri (${rawComics.length - comics.length} varyant filtrelendi).`);

        const currentData = comics.map(c => ({
            id: c.id.toString(),
            title: c.title,
            thumbnail: c.thumbnailUrl || c.images?.['cover/square']?.url || null
        }));

        const savedMemory = MemoryManager.load();
        const savedIds = MemoryManager.getIds(savedMemory);

        if (savedMemory === null) {
            console.log('[Sistem] İlk çalıştırma: Silent Init.');
            MemoryManager.save(currentData);
            return;
        }

        const newEntries = comics.filter(c => !savedIds.includes(c.id.toString()));

        if (newEntries.length > 0) {
            for (const series of newEntries) {
                const embed = createDetailedEmbed(series, '🆕 Yeni Eklendi');
                await sendViaWebhook([embed]);
            }

            const updatedData = [...(Array.isArray(savedMemory) ? savedMemory : []), ...newEntries.map(c => ({
                id: c.id.toString(),
                title: c.title,
                thumbnail: c.thumbnailUrl || c.images?.['cover/square']?.url || null
            }))];

            MemoryManager.save(updatedData);
            console.log(`[Bildirim] ${newEntries.length} yeni seri gönderildi.`);
        } else {
            console.log('[Kontrol] Yeni içerik yok.');
        }

    } catch (error) {
        console.error(`[Döngü Hatası] ${error.message}`);
    }
}

// ═══════════════════════════════════════════
//  Komut Dinleyici
// ═══════════════════════════════════════════
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(CONFIG.PREFIX)) return;

    const command = message.content.slice(CONFIG.PREFIX.length).trim().toLowerCase();

    if (command === 'paylas') {
        await handlePaylas(message);
    }
});

// ═══════════════════════════════════════════
//  Bot Başlatma
// ═══════════════════════════════════════════
client.once('ready', () => {
    console.log('═'.repeat(50));
    console.log(`[Bot] ${client.user.tag} aktif.`);
    console.log('[Bot] Mimari: Hibrit (Puppeteer Token + Direct Fetch)');
    console.log('[Bot] Prefix: s!');
    console.log('[Bot] Komutlar: s!paylas');
    console.log('[Bot] Döngü: Her 15 dakikada bir kontrol');
    console.log('═'.repeat(50));

    runAutoCheck();
    setInterval(runAutoCheck, CONFIG.INTERVAL_MS);
});

process.on('unhandledRejection', error => {
    console.error('[Kritik Hata]', error);
});

client.login(CONFIG.TOKEN);
