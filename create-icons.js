const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');
const path = require('path');

// İkonlar için klasör oluştur
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

// Logo dosyasının yolu
const logoPath = path.join(__dirname, 'logo.png');

// İkon boyutları
const sizes = [16, 48, 128];

// Ana fonksiyon
async function createIcons() {
  try {
    // Logo dosyasını yükle
    const logo = await loadImage(logoPath);
    
    // Her boyut için ikon oluştur
    for (const size of sizes) {
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');
      
      // Logoyu boyutlandır ve çiz
      ctx.drawImage(logo, 0, 0, size, size);
      
      // PNG olarak kaydet
      const buffer = canvas.toBuffer('image/png');
      const outputPath = path.join(imagesDir, `icon${size}.png`);
      fs.writeFileSync(outputPath, buffer);
      
      console.log(`${size}x${size} ikon oluşturuldu: ${outputPath}`);
    }
    
    console.log('Tüm ikonlar başarıyla oluşturuldu!');
  } catch (error) {
    console.error('Hata oluştu:', error);
  }
}

// Programı çalıştır
createIcons();
