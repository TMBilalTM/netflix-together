const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// İkonlar için klasör oluştur
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

// Logo dosyasının yolu
const logoPath = path.join(__dirname, 'logo.png');

// İkon boyutları
const sizes = [16, 48, 128];

// Her boyut için ikon oluştur
async function createIcons() {
  try {
    for (const size of sizes) {
      const outputPath = path.join(imagesDir, `icon${size}.png`);
      
      await sharp(logoPath)
        .resize(size, size)
        .toFile(outputPath);
      
      console.log(`${size}x${size} ikon oluşturuldu: ${outputPath}`);
    }
    
    console.log('Tüm ikonlar başarıyla oluşturuldu!');
  } catch (error) {
    console.error('Hata oluştu:', error);
  }
}

// Programı çalıştır
createIcons();
