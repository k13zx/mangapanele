# Mangapanel Bot 

Crunchyroll ve Tappytoon üzerindeki yeni manga bölümlerini ve haberlerini takip eden, bunları Discord webhook'u üzerinden şık bir şekilde paylaşan otonom bir bot.

##  Özellikler

- **Tappytoon Takip**: Yeni eklenen serileri ve varyantları otomatik tespit eder.
- **Crunchyroll Takip**: En güncel manga haberlerini yazar, kategori ve görsel detaylarıyla paylaşır.
- **Hibrit Mimari**: Token yönetimi için Puppeteer, hızlı veri çekme için doğrudan Fetch API kullanır.
- **Akıllı Filtre**: Aynı serinin farklı varyantlarını (Uncut, Mature vb.) otomatik filtreleyerek spamı engeller.
- **Manuel Kontrol**: İstediğiniz zaman `s!paylas` komutlarıyla en güncel listeyi dökebilirsiniz.

##  Kurulum

### 1. Gereksinimler
- [Node.js](https://nodejs.org/) (v18 veya üzeri önerilir)
- Git

### 2. Dosyaları İndirin
```bash
git clone https://github.com/Kenshicaldi/mangapanele.git
cd mangapanele
```

### 3. Modülleri Yükleyin
```bash
npm install
```

### 4. Yapılandırma
`.env` dosyasını oluşturun ve aşağıdaki bilgileri girin:
```env
DISCORD_TOKEN=BOT_TOKENINIZ
CHANNEL_ID=LOG_KANAL_ID
WEBHOOK_URL=DISCORD_WEBHOOK_URL_ADRESI
```

##  Çalıştırma

Botu başlatmak için:
```bash
node index.js
```

##  Komutlar

Bot `s!` prefixini kullanır:

- `s!paylas`: Tappytoon'daki en yeni serileri paylaşır.
- `s!paylas crunchy` (veya `cr`): Crunchyroll'daki en güncel manga haberlerini paylaşır.

##  Kullanılan Modüller

- `discord.js`: Discord API ile etkileşim.
- `puppeteer`: Dinamik içerik ve token yakalama.
- `dotenv`: Çevresel değişken yönetimi.
- `node-fetch`: API istekleri.

---
*Geliştirici: [Kenshicaldi](https://github.com/Kenshicaldi)*
