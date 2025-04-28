// Arka planda çalışacak ve senkronizasyonu yönetecek betik

console.log('NetflixTogether: Background script başlatıldı');

// Oda durumlarını saklamak için local storage kullan - daha kalıcı olması için
chrome.storage.local.get(['roomStates'], (result) => {
  if (!result.roomStates) {
    // İlk kez çalışıyorsa boş bir nesne oluştur ve sakla
    chrome.storage.local.set({ roomStates: {} });
  }
});

const NETFLIX_URL = 'https://www.netflix.com/browse';

// Active tabs tracking for message reliability
let activeTabs = {};

// Eklenti yüklendiğinde veya güncellendiğinde çalışacak
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Eklenti ilk kez yüklendiğinde Netflix'i açar
    console.log('NetflixTogether: Eklenti ilk kez yüklendi, Netflix açılıyor');
    launchNetflix();
  }
});

// Track tabs for better messaging
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('netflix.com')) {
    activeTabs[tabId] = { url: tab.url, active: tab.active };
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete activeTabs[tabId];
});

// Eklenti ikonuna tıklandığında çalışacak
chrome.action.onClicked.addListener((tab) => {
  // Eğer zaten Netflix'te ise işlem yapma
  if (tab.url && tab.url.includes('netflix.com')) {
    console.log('NetflixTogether: Zaten Netflix sayfasındayız');
    
    // Mevcut Netflix sayfasına mesaj göndererek arayüz durumunu kontrol et
    checkInterfaceAndReinitialize(tab.id);
    
    return;
  }
  
  // Netflix'te değilse Netflix'i aç
  console.log('NetflixTogether: Netflix açılıyor');
  launchNetflix();
});

function checkInterfaceAndReinitialize(tabId) {
  try {
    // Önce hata yakalamayı engellemek için bir ping gönderelim
    sendSafeMessage(tabId, { type: 'PING' })
      .then(() => {
        // Ping başarılıysa, gerçek kontrol mesajını gönderelim
        return sendSafeMessage(tabId, { type: 'CHECK_INTERFACE' });
      })
      .then(response => {
        if (response && (!response.hasChat || !response.hasVideo)) {
          console.log('NetflixTogether: Arayüz yeniden oluşturuluyor');
          return sendSafeMessage(tabId, { type: 'REINITIALIZE' });
        }
      })
      .catch(err => {
        console.warn('NetflixTogether: Arayüz kontrol hatası, yeniden yükleme deneniyor', err);
        // Content script yüklenmemiş olabilir, yeniden yüklemeyi deneyelim
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        }).catch(e => console.error('Script yükleme hatası:', e));
      });
  } catch (e) {
    console.error('NetflixTogether: Kontrol hatası:', e);
  }
}

// Güvenli mesaj gönderme fonksiyonu - Promise tabanlı ve hata yönetimli
function sendSafeMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      // Timeout ile güvenli mesajlaşma (10 saniye zaman aşımı)
      const timeout = setTimeout(() => {
        reject(new Error('Mesaj zaman aşımına uğradı'));
      }, 10000);
      
      chrome.tabs.sendMessage(tabId, message, response => {
        clearTimeout(timeout);
        
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Yanıt gerektirmeyen mesajlar için özel gönderme fonksiyonu
function sendMessageNoResponse(tabId, message) {
  try {
    // Bu fonksiyon yanıt beklemeyecek şekilde çağrılır
    chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    console.warn('NetflixTogether: Mesaj gönderme hatası:', e);
  }
}

// Netflix'i açma ve film seçimine yönlendirme fonksiyonu
function launchNetflix() {
  // Açık Netflix sekmeleri kontrol et
  chrome.tabs.query({ url: '*://*.netflix.com/*' }, (tabs) => {
    if (tabs.length > 0) {
      // Eğer açık bir Netflix sekmesi varsa, o sekmeye geç
      console.log('NetflixTogether: Mevcut Netflix sekmesi bulundu, ona geçiliyor');
      chrome.tabs.update(tabs[0].id, { 
        active: true,
        url: NETFLIX_URL 
      });
    } else {
      // Yeni bir Netflix sekmesi aç
      console.log('NetflixTogether: Yeni Netflix sekmesi açılıyor');
      chrome.tabs.create({ url: NETFLIX_URL });
    }
  });
}

// Mesaj alıcı - kodu güncelleyerek runtime.lastError yönetimini iyileştirme
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('NetflixTogether Background: Mesaj alındı', message.type);
  
  // Yanıt bekleyen mesaj işleyicileri için bir bayrak
  let willSendAsyncResponse = false;
  
  try {
    switch (message.type) {
      case 'PING':
        // Basit ping kontrolü için hemen yanıt ver
        sendResponse({ success: true, pong: true });
        break;
    
      case 'CREATE_ROOM':
        willSendAsyncResponse = true;
        // Storage'dan mevcut oda durumlarını al
        chrome.storage.local.get(['roomStates'], (result) => {
          try {
            const roomStates = result.roomStates || {};
            
            // Yeni bir oda ID'si oluştur
            const roomId = generateRoomId();
            
            // Odayı kaydet
            roomStates[roomId] = { 
              owner: message.userId,
              participants: [message.userId],
              videoState: 'paused',
              currentTime: 0,
              createdAt: new Date().toISOString()
            };
            
            // Storage'ı güncelle
            chrome.storage.local.set({ roomStates }, () => {
              if (chrome.runtime.lastError) {
                console.error('NetflixTogether: Storage güncelleme hatası:', chrome.runtime.lastError);
                try { sendResponse({ success: false, error: "Storage hatası" }); } catch (e) {}
                return;
              }
              
              console.log(`NetflixTogether: Yeni oda oluşturuldu, ID: ${roomId}`);
              try { sendResponse({ success: true, roomId: roomId }); } catch (e) {}
            });
          } catch (e) {
            console.error('NetflixTogether: CREATE_ROOM işlem hatası:', e);
            try { sendResponse({ success: false, error: e.message }); } catch (e) {}
          }
        });
        break;

      case 'JOIN_ROOM':
        willSendAsyncResponse = true;
        chrome.storage.local.get(['roomStates'], (result) => {
          try {
            const roomStates = result.roomStates || {};
            
            if (roomStates[message.roomId]) {
              // Katılımcıyı odaya ekle
              if (!roomStates[message.roomId].participants.includes(message.userId)) {
                roomStates[message.roomId].participants.push(message.userId);
              }
              
              // Storage'ı güncelle
              chrome.storage.local.set({ roomStates }, () => {
                console.log(`NetflixTogether: ${message.userId} odaya katıldı, ID: ${message.roomId}`);
                try {
                  sendResponse({ 
                    success: true, 
                    videoState: roomStates[message.roomId].videoState,
                    currentTime: roomStates[message.roomId].currentTime
                  });
                } catch (e) {
                  console.error('NetflixTogether: Yanıt gönderilirken hata:', e);
                }
              });
            } else {
              console.error('NetflixTogether: Oda bulunamadı', message.roomId);
              try { sendResponse({ success: false, error: "Oda bulunamadı" }); } catch (e) {}
            }
          } catch (e) {
            console.error('NetflixTogether: JOIN_ROOM işlem hatası:', e);
            try { sendResponse({ success: false, error: e.message }); } catch (e) {}
          }
        });
        break;

      case 'UPDATE_VIDEO_STATE':
        // Video durumu güncelleme için asenkron yanıta gerek yok
        // İşlemi hemen yapıp mesajı ileterek gecikmeyi azaltalım
        // Bu işlem için hemen yanıt verelim ve asenkron işlemi arka planda başlatalım
        try {
          // İşlemi başlat ama yanıt bekleme
          syncVideoStateToRoom(message, sender);
          // Hemen başarı yanıtını gönder
          sendResponse({ success: true });
        } catch (e) {
          console.error('NetflixTogether: Video durumu güncelleme hatası:', e);
          sendResponse({ success: false, error: e.message });
        }
        break;

      case 'CHAT_MESSAGE':
        // Sohbet mesajı için asenkron yanıta gerek yok
        try {
          // İşlemi başlat ama yanıt bekleme
          broadcastChatMessage(message);
          // Hemen başarı yanıtını gönder
          sendResponse({ success: true });
        } catch (e) {
          console.error('NetflixTogether: Sohbet mesajı gönderme hatası:', e);
          sendResponse({ success: false, error: e.message });
        }
        break;
        
      case 'OPEN_NETFLIX':
        launchNetflix();
        sendResponse({ success: true });
        break;
        
      case 'DEBUG_INFO':
        // Debug bilgilerini konsola yaz
        console.log('NetflixTogether Debug Bilgileri:', message.data);
        sendResponse({ success: true });
        break;
        
      default:
        console.warn('NetflixTogether: Tanınmayan mesaj tipi:', message.type);
        sendResponse({ success: false, error: "Tanınmayan mesaj tipi" });
    }
  } catch (error) {
    console.error('NetflixTogether: Mesaj işlenirken hata:', error);
    try {
      sendResponse({ success: false, error: error.message || "Bilinmeyen hata" });
    } catch (e) {
      console.error('NetflixTogether: Hata yanıtı gönderilirken ikincil hata:', e);
    }
  }
  
  return willSendAsyncResponse; // Sadece gerektiğinde asenkron yanıt işaretini döndür
});

// Video durumu senkronizasyon işlemi - yanıt beklemeyen versiyonu
function syncVideoStateToRoom(message, sender) {
  chrome.storage.local.get(['roomStates'], (result) => {
    try {
      const roomStates = result.roomStates || {};
      
      if (roomStates[message.roomId]) {
        // Oda durumunu güncelle
        roomStates[message.roomId].videoState = message.videoState;
        roomStates[message.roomId].currentTime = message.currentTime;
        
        // Storage'ı güncelle
        chrome.storage.local.set({ roomStates }, () => {
          // Odadaki diğer katılımcılara mesaj gönder - yanıt beklemeden
          broadcastToRoom(message.roomId, {
            type: 'SYNC_VIDEO_STATE',
            videoState: message.videoState,
            currentTime: message.currentTime
          }, message.userId);
        });
      } else {
        console.error('NetflixTogether: Video durumu güncellenirken oda bulunamadı');
      }
    } catch (e) {
      console.error('NetflixTogether: Video durumu güncelleme hatası:', e);
    }
  });
}

// Sohbet mesajlarını odaya gönderme fonksiyonu
function broadcastChatMessage(message) {
  chrome.storage.local.get(['roomStates'], (result) => {
    try {
      const roomStates = result.roomStates || {};
      
      if (roomStates[message.roomId]) {
        // Mesajı diğer katılımcılara ilet
        broadcastToRoom(message.roomId, {
          type: 'NEW_CHAT_MESSAGE',
          message: message.text,
          userId: message.userId,
          timestamp: message.timestamp
        }, message.userId);
      } else {
        console.error('NetflixTogether: Sohbet mesajı gönderilirken oda bulunamadı');
      }
    } catch (e) {
      console.error('NetflixTogether: Sohbet mesajı gönderme hatası:', e);
    }
  });
}

// Odadaki tüm katılımcılara mesaj gönderme - yeni hata yönetimi ile
function broadcastToRoom(roomId, message, excludeUserId = null) {
  chrome.storage.local.get(['roomStates'], (result) => {
    try {
      const roomStates = result.roomStates || {};
      
      if (roomStates[roomId]) {
        console.log(`NetflixTogether: Odaya mesaj gönderiliyor, ID: ${roomId}, Tip: ${message.type}`);
        
        // Tüm açık Netflix sekmelerini bul ve mesajı gönder
        chrome.tabs.query({ url: '*://*.netflix.com/watch*' }, (tabs) => {
          if (tabs.length === 0) {
            console.warn('NetflixTogether: Aktif Netflix sekmesi bulunamadı');
            return;
          }
          
          // Tüm sekmelere tek tek mesaj gönder - yanıt bekleme olmadan
          tabs.forEach(tab => {
            // Mesajı gönderirken callback bile sağlamayarak runtime.lastError uyarısını önleyelim
            try {
              // Yanıt gerektirmeyen mesajlar için özel bir wrapper fonksiyonu
              sendMessageNoResponse(tab.id, message);
            } catch (e) {
              console.warn(`NetflixTogether: Sekme ${tab.id}'e mesaj gönderilirken hata, devam ediliyor:`, e);
            }
          });
        });
      }
    } catch (e) {
      console.error('NetflixTogether: Odaya mesaj gönderirken hata:', e);
    }
  });
}

// Netflix içeriği yüklendiğinde çalışacak
chrome.webNavigation.onCompleted.addListener((details) => {
  console.log('NetflixTogether: Sayfa yükleme olayı algılandı:', details.url);
  
  // Netflix ana sayfası yüklendiğinde çalıştırılacak fonksiyon
  if (details.url.includes('netflix.com/browse')) {
    console.log('NetflixTogether: Netflix ana sayfası yüklendi');
    setTimeout(() => {
      try {
        chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          function: suggestPopularContent
        }).catch(err => {
          console.error('NetflixTogether: Script çalıştırma hatası:', err);
        });
      } catch (e) {
        console.error('NetflixTogether: executeScript hatası:', e);
      }
    }, 3000); // Biraz daha uzun bekleme süresi
  }
  
  // Netflix izleme sayfasında eklenti arayüzünü başlatmaya çalış - güvenli mesaj gönderimi
  if (details.url.includes('netflix.com/watch')) {
    console.log('NetflixTogether: Netflix izleme sayfası yüklendi');
    
    // Sayfanın tamamen yüklenmesi için daha uzun bekle
    setTimeout(() => {
      try {
        // Content script'e yanıt beklemeden mesaj göndermeyi dene
        sendMessageNoResponse(details.tabId, { type: 'REINITIALIZE' });
        
        // Content script yanıt vermeye çalıştığında oluşan hataları gizle
      } catch (e) {
        console.error('NetflixTogether: REINITIALIZE mesajı gönderme hatası:', e);
      }
    }, 2500);
  }
}, { url: [{ hostSuffix: 'netflix.com' }] });

// Netflix sayfasında popüler içerik önerileri gösterme fonksiyonu
function suggestPopularContent() {
  console.log('Netflix sayfası yüklendi, popüler içerik öneri sistemi aktif');
  
  const suggestContent = () => {
    const popularSections = Array.from(document.querySelectorAll('.lolomoRow'))
      .filter(section => {
        const title = section.querySelector('.rowHeader')?.textContent?.toLowerCase() || '';
        return title.includes('popüler') || 
               title.includes('popular') || 
               title.includes('trend') || 
               title.includes('önerilenler') || 
               title.includes('recommended');
      });
    
    if (popularSections.length > 0) {
      const firstPopularSection = popularSections[0];
      const contentItems = firstPopularSection.querySelectorAll('.slider-item');
      
      if (contentItems.length > 0) {
        const randomIndex = Math.floor(Math.random() * contentItems.length);
        const randomContent = contentItems[randomIndex];
        
        const title = randomContent.querySelector('a')?.getAttribute('aria-label') || 'Bilinmeyen içerik';
        console.log(`Önerilen içerik: ${title}`);
        
        const mouseEnter = new MouseEvent('mouseenter', {
          'view': window,
          'bubbles': true,
          'cancelable': true
        });
        randomContent.dispatchEvent(mouseEnter);
        
        console.log('İçerik vurgulandı, kullanıcı seçimi bekliyor');
      }
    }
  };
  
  setTimeout(suggestContent, 3000);
}

// Benzersiz oda ID'si oluştur
function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

// Eklenti durumunu periyodik olarak temizle (eski odaları sil)
setInterval(() => {
  chrome.storage.local.get(['roomStates'], (result) => {
    if (!result.roomStates) return;
    
    const roomStates = result.roomStates;
    const now = new Date();
    let changed = false;
    
    Object.keys(roomStates).forEach(roomId => {
      if (roomStates[roomId].createdAt) {
        const createdAt = new Date(roomStates[roomId].createdAt);
        const hoursDiff = (now - createdAt) / (1000 * 60 * 60);
        
        if (hoursDiff > 24) {
          console.log(`NetflixTogether: Eski oda temizlendi, ID: ${roomId}`);
          delete roomStates[roomId];
          changed = true;
        }
      }
    });
    
    if (changed) {
      chrome.storage.local.set({ roomStates });
    }
  });
}, 1000 * 60 * 60); // Saatte bir kontrol et
