// Netflix sayfasına entegre olacak ve videoyu kontrol edecek betik

console.log('NetflixTogether: Content script yüklendi');

// Tüm global değişkenleri tanımla
let userId = generateUserId();
let roomId = null;
let chatContainer = null;
let videoElement = null;
let syncInterval = null;
let observerActive = false;
let reconnectAttempts = 0;
let extensionActive = true; // Eklentinin aktif olup olmadığını izlemek için
let videoReadyRetryCount = 0;
const MAX_VIDEO_READY_RETRIES = 10;

// ====== ÖNEMLİ: İlk önce yardımcı fonksiyonları tanımlayalım ======
// Yardımcı fonksiyonlar
function generateUserId() {
  return Math.random().toString(36).substring(2, 10);
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

// Extension context invalidated hatası için özel hata işleyici
window.addEventListener('error', function(event) {
  if (event.error && event.error.message && 
      event.error.message.includes('Extension context invalidated')) {
    console.warn('NetflixTogether: Eklenti bağlamı geçersiz oldu, durumu kaydediyorum');
    
    try {
      // Aktif olmadığını işaretle
      extensionActive = false;
      
      // Mevcut durumu kaydet
      if (roomId && videoElement) {
        localStorage.setItem('netflixTogether_lastRoomId', roomId);
        localStorage.setItem('netflixTogether_lastPosition', videoElement.currentTime);
        localStorage.setItem('netflixTogether_timestamp', Date.now());
        
        // Sayfa yenileme önerisi göster
        showReloadSuggestion();
      }
    } catch (e) {
      // Hata işleme esnasında oluşan hatayı sessizce yoksay
      console.error('NetflixTogether: Durum kaydetme hatası', e);
    }
  }
});

// Video oynatma/duraklatma için daha güvenli işlev - geliştirilmiş versiyonu
function safePlayVideo() {
  if (!videoElement || !extensionActive) return false;
  
  try {
    // Video henüz hazır değilse veya Netflix player yüklenmediyse
    const netflixPlayer = document.querySelector('.NFPlayer') || 
                          document.querySelector('.watch-video--player-view');
    
    // Video hazır olmadığında kullanıcıyı bilgilendir ve hazır oluncaya kadar beklet
    if (!videoElement.readyState || videoElement.readyState < 1 || !netflixPlayer) {
      videoReadyRetryCount++;
      
      if (videoReadyRetryCount === 1) {
        // İlk denemede yükleniyor bildirimi göster
        showVideoLoadingNotification();
      }
      
      // Maksimum deneme sayısını kontrol et
      if (videoReadyRetryCount <= MAX_VIDEO_READY_RETRIES) {
        console.warn(`NetflixTogether: Video hazır değil, oynatma erteleniyor (${videoReadyRetryCount}/${MAX_VIDEO_READY_RETRIES})`);
        
        // Netflix'in içerik yüklemesini hızlandırmak için
        if (videoReadyRetryCount > 3) {
          triggerNetflixContentLoad();
        }
        
        setTimeout(safePlayVideo, 1000); // Daha uzun bekleme süresi (1 saniye)
        return false;
      } else {
        // Maksimum denemeye ulaşıldığında manuel işlem için kullanıcıya bildir
        console.error('NetflixTogether: Video hazırlık süre aşımı, manuel işlem gerekiyor');
        showVideoPreparationFailedOverlay();
        return false;
      }
    }
    
    // Video hazır olduğunda yükleniyor bildirimini kaldır
    if (videoReadyRetryCount > 0) {
      hideNotification('netflix-together-loading-notification');
      videoReadyRetryCount = 0; // Sayacı sıfırla
    }
    
    // Netflix'in kendi oynatma kontrollerine erişmeyi dene
    const playButton = document.querySelector('.button-nfplayerPlay') || 
                       document.querySelector('.PlayPause') || 
                       document.querySelector('[data-uia="control-play-pause-play"]');
    
    if (playButton && videoElement.paused) {
      console.log('NetflixTogether: Netflix oynat düğmesi bulundu, tıklama deneyi yapılıyor');
      try {
        // Netflix'in kendi butonuna tıklayarak oynatmayı deneyelim
        playButton.click();
        
        // Tıklama işleminin video üzerinde etkisi olup olmadığını kontrol et
        setTimeout(() => {
          if (videoElement.paused) {
            console.log('NetflixTogether: Buton tıklama işe yaramadı, HTML5 API kullanılıyor');
            
            // Standart HTML5 video API'sini deneyin
            tryDirectVideoPlay();
          } else {
            console.log('NetflixTogether: Video Netflix kontrolüyle başarıyla oynatıldı');
          }
        }, 100);
        
        return true;
      } catch (e) {
        console.warn('NetflixTogether: Netflix düğmesi tıklama hatası:', e);
        // Hata durumunda HTML5 video API'sine geri dön
      }
    }
    
    // Direkt video API'si ile oynatmayı dene
    return tryDirectVideoPlay();
    
  } catch (e) {
    console.error('NetflixTogether: Video oynatma hatası:', e);
    showDrmPlayOverlay();
    return false;
  }
}

// Netflix'in içerik yükleme sürecini hızlandırmaya çalışan fonksiyon
function triggerNetflixContentLoad() {
  try {
    // Netflix player alanına mouse hover efekti ile yüklemeyi tetikle
    const playerArea = document.querySelector('.NFPlayer') || 
                      document.querySelector('.watch-video--player-view');
    
    if (playerArea) {
      // Mouse events ile Netflix'in lazy-loading mekanizmasını tetikle
      const mouseOver = new MouseEvent('mouseover', {
        'view': window,
        'bubbles': true,
        'cancelable': true
      });
      
      const mouseMove = new MouseEvent('mousemove', {
        'view': window,
        'bubbles': true,
        'cancelable': true
      });
      
      playerArea.dispatchEvent(mouseOver);
      playerArea.dispatchEvent(mouseMove);
      
      // Oynat/duraklat kontrol alanına odaklan (bu genellikle içerik yüklemeyi tetikler)
      const controlsArea = document.querySelector('.PlayerControlsNeo__core-controls') ||
                           document.querySelector('.watch-video--bottom-controls-container');
      
      if (controlsArea) {
        controlsArea.dispatchEvent(mouseOver);
      }
    }
    
    // Direkt video elementinin zamana erişimi ile yüklemeyi tetikle 
    if (videoElement) {
      // Bu bazen Netflix'in video içeriğini yüklemesini tetikler
      try { 
        const currentTime = videoElement.currentTime;
        videoElement.currentTime = currentTime + 0.1;
        setTimeout(() => {
          videoElement.currentTime = currentTime;
        }, 100);
      } catch (e) {
        // Hata olursa görmezden gel
      }
    }
  } catch (e) {
    console.warn('NetflixTogether: İçerik yükleme tetikleme hatası:', e);
  }
}

// Doğrudan HTML5 video API'si ile oynatmayı dene
function tryDirectVideoPlay() {
  try {
    const playPromise = videoElement.play();
    return handlePlayPromise(playPromise);
  } catch (e) {
    console.error('NetflixTogether: Direkt video oynatma hatası:', e);
    showDrmPlayOverlay();
    return false;
  }
}

// Video yükleniyor bildirimi göster
function showVideoLoadingNotification() {
  // Hali hazırda bildirim varsa gösterme
  if (document.getElementById('netflix-together-loading-notification')) return;
  
  try {
    const notification = document.createElement('div');
    notification.id = 'netflix-together-loading-notification';
    notification.className = 'netflix-together-notification loading';
    notification.innerHTML = `
      <div class="notification-content info">
        <div class="loading-spinner"></div>
        <span class="notification-message">Netflix içeriği hazırlanıyor...</span>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // 30 saniye sonra otomatik kaldır (eğer hala gösteriliyorsa)
    setTimeout(() => {
      hideNotification('netflix-together-loading-notification');
    }, 30000);
  } catch (e) {
    console.error('NetflixTogether: Yükleniyor bildirimi oluşturma hatası:', e);
  }
}

// Video hazırlık sorunu bildirim overlay'ı
function showVideoPreparationFailedOverlay() {
  // Mevcut bildirimleri kaldır
  hideNotification('netflix-together-loading-notification');
  
  // Hali hazırda overlay varsa gösterme
  if (document.getElementById('netflix-together-video-prep-failed')) return;
  
  try {
    const overlay = document.createElement('div');
    overlay.id = 'netflix-together-video-prep-failed';
    overlay.className = 'netflix-together-overlay';
    overlay.innerHTML = `
      <div class="overlay-content">
        <div class="overlay-header">
          <h3>Video Hazırlık Sorunu</h3>
          <span class="close-btn">&times;</span>
        </div>
        <div class="overlay-body">
          <p><strong>Netflix videosu hazırlanamadı.</strong></p>
          <p>Videoyu izleyebilmeniz için:</p>
          <ol>
            <li>Sayfayı yenilemeyi deneyin</li>
            <li>Video kontroller çubuğuna tıklayarak videoyu manuel başlatın</li>
            <li>Videoyu başlattıktan sonra "Senkronize Et" düğmesine tıklayın</li>
          </ol>
          <div class="overlay-buttons">
            <button id="netflix-together-reload-page-btn" class="primary-btn">Sayfayı Yenile</button>
            <button id="netflix-together-video-manual-sync" class="secondary-btn">Senkronize Et</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Kapatma düğmesi
    overlay.querySelector('.close-btn').addEventListener('click', () => {
      overlay.remove();
    });
    
    // Sayfa yenileme düğmesi
    document.getElementById('netflix-together-reload-page-btn').addEventListener('click', function() {
      window.location.reload();
    });
    
    // Manuel senkronizasyon düğmesi
    document.getElementById('netflix-together-video-manual-sync').addEventListener('click', function() {
      try {
        if (videoElement) {
          // Mevcut video durumu ve konumunu hemen senkronize et
          updateVideoState(true); // Force update parametresi
          overlay.remove();
        } else {
          alert('Video henüz hazır değil. Lütfen önce videoyu manuel olarak başlatın.');
        }
      } catch (e) {
        console.error('NetflixTogether: Manuel senkronizasyon hatası:', e);
      }
    });
  } catch (e) {
    console.error('NetflixTogether: Video hazırlık hatası overlay oluşturma hatası:', e);
  }
}

// Bildirimi kaldırma yardımcı fonksiyonu
function hideNotification(notificationId) {
  const notification = document.getElementById(notificationId);
  if (notification) {
    notification.classList.add('fade-out');
    setTimeout(() => {
      if (document.body.contains(notification)) {
        notification.remove();
      }
    }, 500);
  }
}

// Play promise'i işleme fonksiyonu
function handlePlayPromise(playPromise) {
  if (playPromise !== undefined) {
    playPromise.then(() => {
      console.log('NetflixTogether: Video başarıyla oynatıldı');
      
      // Varsa overlay'ı kaldır
      const overlay = document.getElementById('netflix-together-play-overlay');
      if (overlay) overlay.remove();
      
      return true;
    }).catch(error => {
      console.warn('NetflixTogether: Video otomatik olarak oynatılamadı:', error);
      
      // DRM veya autoplay kısıtlaması olabilir - kullanıcıya bilgi ver
      showDrmPlayOverlay();
      return false;
    });
  }
  return true;
}

// Video durumu güncelleme - readyState kontrolünü geliştir
function updateVideoState(force = false) {
  if ((!roomId && !force) || !videoElement || !extensionActive) return;
  
  try {
    // Video elemanının geçerli olduğundan emin ol ve hazır olma durumunu kontrol et
    if (videoElement.readyState === 0) {
      if (force) {
        // Zorunlu güncellemelerde kullanıcıya bilgi ver
        showNotification('Video henüz yüklenemedi. Lütfen Netflix oynatıcısını manuel başlatın.', 'warning');
      } else {
        console.warn('NetflixTogether: Video henüz hazır değil, güncelleme atlanıyor');
      }
      return;
    }
    
    // İçeriği hazır olan video için normal işleme devam et
    const currentState = videoElement.paused ? 'paused' : 'playing';
    const currentTime = videoElement.currentTime || 0;
    
    // Video konumunu lokalde kaydet
    localStorage.setItem('netflixTogether_lastPosition', currentTime);
    
    // Promise tabanlı mesaj gönderimi için wrapper
    const sendStateUpdateMessage = () => {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({
            type: 'UPDATE_VIDEO_STATE',
            roomId: roomId,
            userId: userId,
            videoState: currentState,
            currentTime: currentTime,
            forced: force // Zorunlu güncelleme olup olmadığı bilgisi
          }, response => {
            if (chrome.runtime.lastError) {
              console.debug('NetflixTogether: Video durumu güncelleme yanıtı alınamadı');
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        } catch (e) {
          reject(e);
        }
      });
    };
    
    // Mesajı gönder ve hataları yakala
    sendStateUpdateMessage()
      .then(response => {
        if (force && response && response.success) {
          // Zorunlu güncelleme başarılıysa kullanıcıya bildir
          showSuccessNotification('Video durumu başarıyla senkronize edildi!');
        }
      })
      .catch(error => {
        console.warn('NetflixTogether: Video durumu güncellenemedi:', error);
        
        // Context invalidation kontrolü
        if (error.message && error.message.includes('Extension context invalidated')) {
          extensionActive = false;
          showReloadSuggestion();
        }
      });
  } catch (e) {
    console.error('NetflixTogether: Video durumu güncelleme hatası:', e);
    
    // Extension context invalidated hatası mı kontrol et
    if (e.message && e.message.includes('Extension context invalidated')) {
      extensionActive = false;
      showReloadSuggestion();
    }
  }
}

// Bildirim gösterme fonksiyonu - tüm bildirimler için genel kullanım
function showNotification(message, type = 'info', duration = 5000) {
  const notificationId = `netflix-together-notification-${Date.now()}`;
  
  try {
    const notification = document.createElement('div');
    notification.id = notificationId;
    notification.className = 'netflix-together-notification';
    notification.innerHTML = `
      <div class="notification-content ${type}">
        <span class="notification-message">${message}</span>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Belirtilen süre sonra kaybolsun
    setTimeout(() => {
      hideNotification(notificationId);
    }, duration);
    
    return notificationId;
  } catch (e) {
    console.error('NetflixTogether: Bildirim oluşturma hatası:', e);
    return null;
  }
}

// Geliştirilmiş DRM uyarı overlay'ı
function showDrmPlayOverlay() {
  // Hali hazırda overlay varsa gösterme
  if (document.getElementById('netflix-together-play-overlay')) return;
  
  try {
    const overlay = document.createElement('div');
    overlay.id = 'netflix-together-play-overlay';
    overlay.className = 'netflix-together-overlay';
    overlay.innerHTML = `
      <div class="overlay-content">
        <div class="overlay-header">
          <h3>Video Oynatılamadı</h3>
          <span class="close-btn">&times;</span>
        </div>
        <div class="overlay-body">
          <p><strong>Netflix DRM koruması otomatik oynatmayı engelliyor.</strong></p>
          <p>Arkadaşınızla senkronize izlemek için lütfen:</p>
          <ol>
            <li>Videoyu manuel olarak başlatın</li>
            <li>Aşağıdaki "Senkronize Et" düğmesine tıklayın</li>
          </ol>
          <div class="overlay-buttons">
            <button id="netflix-together-manual-play" class="primary-btn">Videoyu Başlat</button>
            <button id="netflix-together-sync-video" class="secondary-btn">Senkronize Et</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Kapatma düğmesi
    overlay.querySelector('.close-btn').addEventListener('click', () => {
      overlay.remove();
    });
    
    // Manuel oynatma düğmesi
    document.getElementById('netflix-together-manual-play').addEventListener('click', function() {
      try {
        // Netflix'in oynat düğmesini bul ve tıkla
        const netflixPlayButton = document.querySelector('.button-nfplayerPlay') || 
                                 document.querySelector('.PlayPause') || 
                                 document.querySelector('[data-uia="control-play-pause-play"]');
                                 
        if (netflixPlayButton) {
          netflixPlayButton.click();
        } else {
          videoElement.play();
        }
        
        // Overlay'i hemen kaldırma - kullanıcılar senkronizasyon düğmesine de tıklamak isteyebilir
      } catch (e) {
        console.error('NetflixTogether: Manuel oynatma hatası:', e);
      }
    });
    
    // Senkronizasyon düğmesi
    document.getElementById('netflix-together-sync-video').addEventListener('click', function() {
      try {
        // Mevcut video durumu ve konumunu hemen senkronize et
        updateVideoState(true); // Force update parametresi
        overlay.remove();
      } catch (e) {
        console.error('NetflixTogether: Senkronizasyon hatası:', e);
      }
    });
    
    // 20 saniye sonra overlay'i otomatik olarak kaldır (uzun süre bırakıyoruz ki kullanıcı görsün)
    setTimeout(() => {
      if (document.body.contains(overlay)) {
        overlay.remove();
      }
    }, 20000);
  } catch (e) {
    console.error('NetflixTogether: Overlay oluşturma hatası:', e);
  }
}

// Kullanıcıdan manuel oynatma talep etmek için ek UI
function showPlayRequestOverlay() {
  // Hali hazırda overlay varsa gösterme
  if (document.getElementById('netflix-together-play-overlay')) return;
  
  try {
    const overlay = document.createElement('div');
    overlay.id = 'netflix-together-play-overlay';
    overlay.className = 'netflix-together-overlay';
    overlay.innerHTML = `
      <div class="overlay-content">
        <p>Video otomatik olarak oynatılamadı.</p>
        <p>Netflix, DRM korumalı içeriklerde otomatik oynatma kısıtlaması uyguluyor.</p>
        <button id="netflix-together-manual-play">Videoyu Başlat</button>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Butona tıklandığında videoyu oynat ve overlay'i kaldır
    document.getElementById('netflix-together-manual-play').addEventListener('click', function() {
      try {
        videoElement.play();
        overlay.remove();
      } catch (e) {
        console.error('NetflixTogether: Manuel oynatma hatası:', e);
      }
    });
    
    // 10 saniye sonra overlay'i otomatik olarak kaldır
    setTimeout(() => {
      if (document.body.contains(overlay)) {
        overlay.remove();
      }
    }, 10000);
  } catch (e) {
    console.error('NetflixTogether: Overlay oluşturma hatası:', e);
  }
}

// Sayfayı yenileme önerisi gösterme
function showReloadSuggestion() {
  // Hali hazırda öneri gösteriliyorsa tekrar gösterme
  if (document.getElementById('netflix-together-reload-suggestion')) return;
  
  try {
    const suggestion = document.createElement('div');
    suggestion.id = 'netflix-together-reload-suggestion';
    suggestion.className = 'netflix-together-overlay';
    suggestion.innerHTML = `
      <div class="overlay-content">
        <p>Uzantı bağlantısında bir sorun oluştu.</p>
        <p>Daha iyi bir deneyim için sayfayı yenilemeniz önerilir.</p>
        <button id="netflix-together-reload-page">Sayfayı Yenile</button>
        <button id="netflix-together-dismiss">Şimdi Değil</button>
      </div>
    `;
    
    document.body.appendChild(suggestion);
    
    document.getElementById('netflix-together-reload-page').addEventListener('click', function() {
      window.location.reload();
    });
    
    document.getElementById('netflix-together-dismiss').addEventListener('click', function() {
      suggestion.remove();
    });
    
    // 15 saniye sonra öneriyi otomatik kaldır
    setTimeout(() => {
      if (document.body.contains(suggestion)) {
        suggestion.remove();
      }
    }, 15000);
  } catch (e) {
    console.error('NetflixTogether: Yenileme önerisi oluşturma hatası:', e);
  }
}

// Önceki oturum durumunu kontrol et
function checkPreviousState() {
  try {
    const lastRoomId = localStorage.getItem('netflixTogether_lastRoomId');
    const lastPosition = localStorage.getItem('netflixTogether_lastPosition');
    const timestamp = localStorage.getItem('netflixTogether_timestamp');
    
    // Son kullanımdan bu yana 30 dakikadan az geçmişse
    if (lastRoomId && timestamp && (Date.now() - parseInt(timestamp)) < 30 * 60 * 1000) {
      console.log(`NetflixTogether: Önceki oturum bulundu, Oda ID: ${lastRoomId}`);
      
      // Kullanıcıya oturuma devam etme seçeneği sun
      setTimeout(() => {
        showRejoinPrompt(lastRoomId, parseFloat(lastPosition || 0));
      }, 2000); // Arayüz hazır olması için kısa bir süre bekle
    }
  } catch (e) {
    console.error('NetflixTogether: Önceki durum kontrolü hatası:', e);
  }
}

// Önceki odaya yeniden katılma istemi
function showRejoinPrompt(roomId, lastPosition) {
  // Halihazırda bir odadaysak gösterme
  if (window.roomId) return;
  
  try {
    const prompt = document.createElement('div');
    prompt.id = 'netflix-together-rejoin-prompt';
    prompt.className = 'netflix-together-overlay';
    prompt.innerHTML = `
      <div class="overlay-content">
        <p>Önceki Netflix Together oturumunuza devam etmek ister misiniz?</p>
        <div class="button-group">
          <button id="netflix-together-rejoin-yes">Evet, devam et</button>
          <button id="netflix-together-rejoin-no">Hayır</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(prompt);
    
    // Evet butonu - odaya yeniden katıl
    document.getElementById('netflix-together-rejoin-yes').addEventListener('click', function() {
      const inputElement = document.getElementById('room-id-input');
      if (inputElement) {
        inputElement.value = roomId;
        joinRoom();
      } else {
        // UI henüz hazır değil, önce arayüzü oluştur
        initializeExtension();
        setTimeout(() => {
          const retryInput = document.getElementById('room-id-input');
          if (retryInput) {
            retryInput.value = roomId;
            joinRoom();
          }
        }, 1000);
      }
      prompt.remove();
    });
    
    // Hayır butonu - prompt'u kaldır
    document.getElementById('netflix-together-rejoin-no').addEventListener('click', function() {
      prompt.remove();
      // Eski oturum bilgilerini temizle
      localStorage.removeItem('netflixTogether_lastRoomId');
      localStorage.removeItem('netflixTogether_lastPosition');
      localStorage.removeItem('netflixTogether_timestamp');
    });
    
    // 20 saniye sonra prompt'u otomatik kaldır
    setTimeout(() => {
      if (document.body.contains(prompt)) {
        prompt.remove();
      }
    }, 20000);
  } catch (e) {
    console.error('NetflixTogether: Yeniden katılma istemi oluşturma hatası:', e);
  }
}

// ====== Sohbet ve UI ile ilgili fonksiyonlar ======
// Sohbet arayüzünü oluşturma fonksiyonu
function createChatInterface() {
  console.log('NetflixTogether: Sohbet arayüzü oluşturuluyor');
  
  // Mevcut sohbet konteynerini temizle
  if (chatContainer) {
    chatContainer.remove();
    chatContainer = null;
  }
  
  try {
    // Yeni sohbet konteynerini oluştur
    chatContainer = document.createElement('div');
    chatContainer.id = 'netflix-sync-chat';
    chatContainer.className = 'netflix-sync-chat';
    
    // HTML içeriğini oluştur
    chatContainer.innerHTML = `
      <div class="chat-header">
        <h3>NetflixTogether</h3>
        <button id="toggle-chat-btn" class="toggle-chat-btn">≪</button>
        <div class="room-controls">
          <input type="text" id="room-id-input" placeholder="Oda linki" style="display: none;">
          <button id="create-room-btn">Oda Oluştur</button>
          <button id="join-room-btn">Odaya Katıl</button>
          <button id="leave-room-btn" style="display: none;">Odadan Ayrıl</button>
        </div>
        <div class="room-info" style="display: none;">
          <span>Oda Linki: </span>
          <div class="link-container">
            <input type="text" id="share-link-input" readonly>
            <button id="copy-link-btn">Kopyala</button>
          </div>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input">
        <input type="text" id="chat-message-input" placeholder="Mesajınızı yazın..." disabled>
        <button id="send-message-btn" disabled>Gönder</button>
      </div>
    `;
    
    // Sayfaya ekle - Netflix'in yüklenme durumundan emin olalım
    const injectChatUI = () => {
      if (document.body) {
        document.body.appendChild(chatContainer);
        console.log('NetflixTogether: Sohbet arayüzü DOM\'a eklendi');
        
        // Olay dinleyicilerini bağla
        setupChatEventListeners();
      } else {
        console.warn('NetflixTogether: document.body henüz mevcut değil, tekrar deneniyor');
        setTimeout(injectChatUI, 500);
      }
    };
    
    // Sohbet arayüzünü ekle
    injectChatUI();
  } catch (error) {
    console.error('NetflixTogether: Sohbet arayüzü oluşturulurken hata:', error);
  }
}

// Sohbet UI olay dinleyicilerini bağlama
function setupChatEventListeners() {
  try {
    // Butonları seç
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const roomIdInput = document.getElementById('room-id-input');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const sendMsgBtn = document.getElementById('send-message-btn');
    const msgInput = document.getElementById('chat-message-input');
    const toggleBtn = document.getElementById('toggle-chat-btn');
    const copyBtn = document.getElementById('copy-link-btn');
    
    // Olay dinleyicileri ekle - her biri için kontrol yaparak ekle
    if (createRoomBtn) createRoomBtn.addEventListener('click', createRoom);
    if (joinRoomBtn) joinRoomBtn.addEventListener('click', toggleJoinRoomInput);
    if (roomIdInput) roomIdInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') joinRoom();
    });
    if (leaveRoomBtn) leaveRoomBtn.addEventListener('click', leaveRoom);
    if (sendMsgBtn) sendMsgBtn.addEventListener('click', sendMessage);
    if (msgInput) msgInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    if (toggleBtn) toggleBtn.addEventListener('click', toggleChatVisibility);
    if (copyBtn) copyBtn.addEventListener('click', copyShareLink);
    
    console.log('NetflixTogether: Sohbet arayüzü olay dinleyicileri bağlandı');
  } catch (error) {
    console.error('NetflixTogether: Sohbet olay dinleyicileri bağlanırken hata:', error);
  }
}

// Diğer UI yardımcı fonksiyonlar
function toggleChatVisibility() {
  const chatPanel = document.getElementById('netflix-sync-chat');
  const toggleBtn = document.getElementById('toggle-chat-btn');
  
  if (chatPanel.classList.contains('collapsed')) {
    chatPanel.classList.remove('collapsed');
    toggleBtn.textContent = '≪';
  } else {
    chatPanel.classList.add('collapsed');
    toggleBtn.textContent = '≫';
  }
}

// Aktif oda UI durumu
function showActiveRoomUI() {
  try {
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const roomIdInput = document.getElementById('room-id-input');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const roomInfo = document.querySelector('.room-info');
    const chatMsgInput = document.getElementById('chat-message-input');
    const sendMsgBtn = document.getElementById('send-message-btn');
    
    // Null kontrolü yaparak hata oluşmasını engelle
    if (createRoomBtn) createRoomBtn.style.display = 'none';
    if (joinRoomBtn) joinRoomBtn.style.display = 'none';
    if (roomIdInput) roomIdInput.style.display = 'none';
    if (leaveRoomBtn) leaveRoomBtn.style.display = 'inline-block';
    if (roomInfo) roomInfo.style.display = 'block';
    if (chatMsgInput) chatMsgInput.disabled = false;
    if (sendMsgBtn) sendMsgBtn.disabled = false;
    
    console.log('NetflixTogether: Aktif oda UI görünümü ayarlandı');
  } catch (e) {
    console.error('NetflixTogether: UI güncelleme hatası:', e);
  }
}

// İnaktif oda UI durumu
function showInactiveRoomUI() {
  try {
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const roomIdInput = document.getElementById('room-id-input');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const roomInfo = document.querySelector('.room-info');
    const chatMsgInput = document.getElementById('chat-message-input');
    const sendMsgBtn = document.getElementById('send-message-btn');
    const chatMessages = document.getElementById('chat-messages');
    
    // Null kontrolü yaparak hata oluşmasını engelle
    if (createRoomBtn) createRoomBtn.style.display = 'inline-block';
    if (joinRoomBtn) {
      joinRoomBtn.style.display = 'inline-block';
      joinRoomBtn.textContent = 'Odaya Katıl';
    }
    if (roomIdInput) roomIdInput.style.display = 'none';
    if (leaveRoomBtn) leaveRoomBtn.style.display = 'none';
    if (roomInfo) roomInfo.style.display = 'none';
    if (chatMsgInput) chatMsgInput.disabled = true;
    if (sendMsgBtn) sendMsgBtn.disabled = true;
    
    // Sohbet mesajlarını temizle
    if (chatMessages) chatMessages.innerHTML = '';
    
    console.log('NetflixTogether: İnaktif oda UI görünümü ayarlandı');
  } catch (e) {
    console.error('NetflixTogether: UI güncelleme hatası:', e);
  }
}

// Oda linki oluşturma fonksiyonu
function generateShareLink(roomId) {
  // Mevcut Netflix URL'sini al
  const currentUrl = window.location.href.split('#')[0]; // Hash kısmını çıkar
  // Paylaşım linkini oluştur
  return `${currentUrl}#netflix-together-room=${roomId}`;
}

// Link kopyalama fonksiyonu
function copyShareLink() {
  const linkInput = document.getElementById('share-link-input');
  linkInput.select();
  document.execCommand('copy');
  
  const copyBtn = document.getElementById('copy-link-btn');
  const originalText = copyBtn.textContent;
  copyBtn.textContent = 'Kopyalandı!';
  setTimeout(() => {
    copyBtn.textContent = originalText;
  }, 2000);
  
  console.log('NetflixTogether: Oda linki panoya kopyalandı');
}

// Mesaj gönderme işlemi
function sendMessage() {
  if (!extensionActive) {
    showReloadSuggestion();
    return;
  }
  
  const messageInput = document.getElementById('chat-message-input');
  const message = messageInput.value.trim();
  
  if (!message || !roomId) return;
  
  const timestamp = new Date().toISOString();
  
  try {
    // Mesajı gönder ancak yanıttan bağımsız olarak UI'ı güncelle
    chrome.runtime.sendMessage({
      type: 'CHAT_MESSAGE',
      roomId: roomId,
      userId: userId,
      text: message,
      timestamp: timestamp
    }).catch(e => {
      console.error('NetflixTogether: Mesaj gönderirken hata:', e);
    });
    
    // Mesaj gönderildikçe hemen kendi mesajımızı ekrana ekle
    addMessageToChat(userId, message, timestamp, true);
    messageInput.value = '';
    console.log('NetflixTogether: Mesaj gönderildi');
  } catch (e) {
    console.error('NetflixTogether: Mesaj gönderilirken hata oluştu', e);
    
    // Context invalidated hatası ise uygun işlem yap
    if (e.message && e.message.includes('Extension context invalidated')) {
      extensionActive = false;
      showReloadSuggestion();
    } else {
      alert('Mesaj gönderilirken bir hata oluştu. Lütfen tekrar deneyin.');
    }
  }
}

// Sohbet mesajı ekleme
function addMessageToChat(senderId, message, timestamp, isOwnMessage = false) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  
  const messageElement = document.createElement('div');
  messageElement.className = `chat-message ${isOwnMessage ? 'own-message' : 'other-message'}`;
  
  const time = new Date(timestamp);
  const timeStr = `${time.getHours()}:${time.getMinutes().toString().padStart(2, '0')}`;
  
  messageElement.innerHTML = `
    <div class="message-header">
      <span class="sender-id">${senderId.substring(0, 5)}</span>
      <span class="message-time">${timeStr}</span>
    </div>
    <div class="message-content">${escapeHTML(message)}</div>
  `;
  
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ====== Oda yönetimi fonksiyonları ======
// Oda oluşturma
function createRoom() {
  if (!extensionActive) {
    showReloadSuggestion();
    return;
  }
  
  console.log('NetflixTogether: Oda oluşturuluyor');
  
  // Oda oluşturma durumunda UI geri bildirim ekle
  const createRoomBtn = document.getElementById('create-room-btn');
  if (createRoomBtn) {
    const originalText = createRoomBtn.textContent;
    createRoomBtn.textContent = 'Oluşturuluyor...';
    createRoomBtn.disabled = true;
    
    // Timeout ekleyerek asenkron işlem zaman aşımı kontrolü
    const timeout = setTimeout(() => {
      // 10 saniye içinde yanıt gelmezse butonu sıfırla ve hata ver
      createRoomBtn.textContent = originalText;
      createRoomBtn.disabled = false;
      alert('İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.');
    }, 10000);
    
    try {
      chrome.runtime.sendMessage({
        type: 'CREATE_ROOM',
        userId: userId
      }).then(response => {
        // Timeout'u temizle
        clearTimeout(timeout);
        
        // UI'ı normal duruma getir
        createRoomBtn.textContent = originalText;
        createRoomBtn.disabled = false;
        
        if (response && response.success) {
          roomId = response.roomId;
          showActiveRoomUI();
          
          // Paylaşım linkini oluştur
          const shareUrl = generateShareLink(roomId);
          const shareInput = document.getElementById('share-link-input');
          if (shareInput) {
            shareInput.value = shareUrl;
          }
          
          console.log(`NetflixTogether: Oda oluşturuldu, ID: ${roomId}`);
          
          // Durumu kaydet
          localStorage.setItem('netflixTogether_lastRoomId', roomId);
          localStorage.setItem('netflixTogether_timestamp', Date.now());
        } else {
          const errorMsg = response && response.error ? response.error : 'Bilinmeyen hata';
          console.error('NetflixTogether: Oda oluşturulurken hata oluştu', errorMsg);
          alert(`Oda oluşturulurken bir hata oluştu: ${errorMsg}`);
        }
      }).catch(error => {
        // Chrome runtime hatalarını yönet
        clearTimeout(timeout);
        createRoomBtn.textContent = originalText;
        createRoomBtn.disabled = false;
        console.error('NetflixTogether: Mesajlaşma hatası:', error);
        
        if (error.message && error.message.includes('Extension context invalidated')) {
          extensionActive = false;
          showReloadSuggestion();
        } else {
          alert('Eklenti ile iletişim sırasında bir hata oluştu. Sayfayı yenilemeyi deneyebilirsiniz.');
        }
      });
    } catch (e) {
      // Chrome runtime hatalarını yönet
      clearTimeout(timeout);
      createRoomBtn.textContent = originalText;
      createRoomBtn.disabled = false;
      console.error('NetflixTogether: Mesajlaşma hatası:', e);
      
      if (e.message && e.message.includes('Extension context invalidated')) {
        extensionActive = false;
        showReloadSuggestion();
      } else {
        alert('Eklenti ile iletişim sırasında bir hata oluştu. Sayfayı yenilemeyi deneyebilirsiniz.');
      }
    }
  }
}

// Odaya katılma butonunu aç/kapat
function toggleJoinRoomInput() {
  const roomInput = document.getElementById('room-id-input');
  const joinBtn = document.getElementById('join-room-btn');
  
  if (roomInput.style.display === 'none') {
    roomInput.style.display = 'inline-block';
    joinBtn.textContent = 'Katıl';
  } else {
    joinRoom();
  }
}

// Odaya katılma işlemi
function joinRoom() {
  if (!extensionActive) {
    showReloadSuggestion();
    return;
  }
  
  const roomInput = document.getElementById('room-id-input');
  if (!roomInput) {
    console.error('NetflixTogether: room-id-input elementi bulunamadı');
    return;
  }
  
  let inputValue = roomInput.value.trim();
  
  console.log(`NetflixTogether: Odaya katılma girişimi, girdi: ${inputValue}`);
  
  // Input değeri link mi yoksa doğrudan oda kodu mu kontrol et
  let roomCode = inputValue;
  
  // Eğer link formatındaysa, oda kodunu çıkar
  if (inputValue.includes('netflix-together-room=')) {
    try {
      // URL nesnesini oluşturmaya çalış
      let url;
      try {
        url = new URL(inputValue);
        roomCode = url.hash.split('netflix-together-room=')[1];
      } catch (e) {
        // URL parse edilemezse, string işleme ile dene
        const parts = inputValue.split('netflix-together-room=');
        if (parts.length > 1) {
          roomCode = parts[1].split(/[&#]/)[0]; // Hash veya diğer parametrelerden ayır
        }
      }
    } catch (e) {
      console.error('NetflixTogether: URL ayrıştırma hatası:', e);
      // Varsayılan olarak tüm inputu kullan
    }
  }
  
  if (!roomCode) {
    console.error('NetflixTogether: Geçersiz oda kodu');
    alert('Geçerli bir oda kodu ya da linki girin!');
    return;
  }
  
  console.log(`NetflixTogether: Odaya katılınıyor, Oda kodu: ${roomCode}`);
  
  try {
    chrome.runtime.sendMessage({
      type: 'JOIN_ROOM',
      roomId: roomCode,
      userId: userId
    }).then(response => {
      if (response && response.success) {
        roomId = roomCode;
        showActiveRoomUI();
        
        // Paylaşım linkini güncelle
        const shareUrl = generateShareLink(roomId);
        const shareInput = document.getElementById('share-link-input');
        if (shareInput) {
          shareInput.value = shareUrl;
        }
        
        // Videoyu güvenli şekilde senkronize et
        if (videoElement) {
          safeSetCurrentTime(response.currentTime);
          
          if (response.videoState === 'playing') {
            safePlayVideo();
          } else {
            safePauseVideo();
          }
        }
        
        console.log(`NetflixTogether: Odaya katılındı, ID: ${roomId}`);
        
        // Durumu kaydet
        localStorage.setItem('netflixTogether_lastRoomId', roomId);
        localStorage.setItem('netflixTogether_timestamp', Date.now());
      } else {
        console.error('NetflixTogether: Odaya katılırken hata oluştu', response?.error);
        alert('Oda bulunamadı veya katılırken bir hata oluştu!');
      }
    }).catch(error => {
      console.error('NetflixTogether: Odaya katılma hatası:', error);
      
      if (error.message && error.message.includes('Extension context invalidated')) {
        extensionActive = false;
        showReloadSuggestion();
      } else {
        alert('Odaya katılırken bir bağlantı hatası oluştu. Sayfayı yenileyip tekrar deneyebilirsiniz.');
      }
    });
  } catch (e) {
    console.error('NetflixTogether: Odaya katılma hatası:', e);
    
    if (e.message && e.message.includes('Extension context invalidated')) {
      extensionActive = false;
      showReloadSuggestion();
    } else {
      alert('Odaya katılırken bir hata oluştu. Sayfayı yenileyip tekrar deneyebilirsiniz.');
    }
  }
}

// Odadan ayrılma
function leaveRoom() {
  console.log(`NetflixTogether: Odadan çıkılıyor, ID: ${roomId}`);
  
  roomId = null;
  showInactiveRoomUI();
  clearInterval(syncInterval);
  
  // Durumu temizle
  localStorage.removeItem('netflixTogether_lastRoomId');
  localStorage.removeItem('netflixTogether_lastPosition');
  localStorage.removeItem('netflixTogether_timestamp');
}

// URL'den oda kodunu kontrol eden fonksiyon
function checkUrlForRoomCode() {
  const hash = window.location.hash;
  console.log(`NetflixTogether: URL hash kontrolü: ${hash}`);
  
  if (hash && hash.includes('netflix-together-room=')) {
    const roomCode = hash.split('netflix-together-room=')[1];
    if (roomCode) {
      console.log(`NetflixTogether: URL'den oda kodu bulundu: ${roomCode}`);
      setTimeout(() => {
        const roomIdInput = document.getElementById('room-id-input');
        if (roomIdInput) {
          roomIdInput.value = roomCode;
          joinRoom();
          // URL'den hash'i temizle
          history.replaceState(null, null, window.location.pathname + window.location.search);
        } else {
          console.warn('NetflixTogether: room-id-input elementi bulunamadı, yeniden deneniyor');
          setTimeout(checkUrlForRoomCode, 1000); // Biraz bekleyip tekrar dene
        }
      }, 1000); // Arayüzün yüklenmesini bekle
    }
  }
}

// ====== Video kontrolü ve izleme fonksiyonları ======
// Video element bulma ve izleme
function findVideoElementWithRetry(attempts = 0) {
  // Netflix'in video elementini bul
  const videoElements = document.querySelectorAll('video');
  
  if (videoElements.length > 0) {
    videoElement = videoElements[0];
    console.log('NetflixTogether: Video elementi bulundu');
    
    // Video kontrollerini gözlemle
    setupVideoListeners();
    return;
  }
  
  // Maksimum 5 deneme yapılsın
  if (attempts < 5) {
    console.log(`NetflixTogether: Video elementi bulunamadı, tekrar deneniyor (${attempts + 1}/5)`);
    // Her denemede bekleme süresini artır
    const delay = 1000 + (attempts * 500);
    setTimeout(() => findVideoElementWithRetry(attempts + 1), delay);
  } else {
    console.error('NetflixTogether: Video elementi 5 denemeden sonra bulunamadı');
  }
}

// Video kontrolü için event dinleyicileri
function setupVideoListeners() {
  if (!videoElement) return;
  
  // Önceki event dinleyicilerini temizle
  videoElement.removeEventListener('play', updateVideoState);
  videoElement.removeEventListener('pause', updateVideoState);
  videoElement.removeEventListener('seeking', updateVideoState);
  
  // Yeni dinleyicileri ekle
  videoElement.addEventListener('play', updateVideoState);
  videoElement.addEventListener('pause', updateVideoState);
  videoElement.addEventListener('seeking', updateVideoState);
  
  // Video hazır olduğunda durumunu izle
  videoElement.addEventListener('canplay', () => {
    console.log('NetflixTogether: Video hazır, oynatılabilir');
  });
  
  // Hata durumlarını izle
  videoElement.addEventListener('error', (e) => {
    console.error('NetflixTogether: Video hata olayı:', videoElement.error);
  });
  
  // Önceki aralığı temizle ve yenisini oluştur
  clearInterval(syncInterval);
  
  // Her 5 saniyede bir video durumunu senkronize et - hata yakalama ile
  syncInterval = setInterval(() => {
    if (roomId && extensionActive) {
      try {
        updateVideoState();
      } catch (e) {
        console.error('NetflixTogether: Senkronizasyon hatası:', e);
        
        // Extension context hatası kontrolü
        if (e.message && e.message.includes('Extension context invalidated')) {
          extensionActive = false;
          clearInterval(syncInterval);
          showReloadSuggestion();
        } else {
          // Diğer hatalarda interval'ı temizle ve yeniden başlat
          clearInterval(syncInterval);
          setupVideoListeners();
        }
      }
    }
  }, 5000);
  
  console.log('NetflixTogether: Video dinleyicileri kuruldu');
}

// ====== Eklenti başlatma ve ana işlevler ======
// Eklenti başlatma fonksiyonu - sayfa hazır olduğunda çağrılır
function initExtensionOnLoad() {
  console.log('NetflixTogether: Sayfa yüklemesi tamamlandı, eklenti başlatılıyor');
  
  // Extension context durumunu sıfırla
  extensionActive = true;
  
  // Küçük bir gecikme ile başlat (Netflix JS yüklemelerinin tamamlanmasını bekle)
  setTimeout(initializeExtension, 1000); 
  
  // URL değişikliklerini izle
  setupUrlChangeListener();
}

// URL değişikliklerini izleme fonksiyonu
function setupUrlChangeListener() {
  if (observerActive) return; // Zaten aktifse tekrar başlatma
  observerActive = true;
  
  console.log('NetflixTogether: URL değişiklik izleyicisi başlatıldı');
  
  // Geçerli URL'yi sakla
  let lastUrl = location.href;
  
  // Netflix'in hash tabanlı yönlendirmesini yakalamak için hashchange olayını dinle
  window.addEventListener('hashchange', urlChangeHandler);
  
  // Push state ve replace state kullanımlarını yakalamak için history API'sini genişlet
  const originalPushState = history.pushState;
  history.pushState = function() {
    originalPushState.apply(this, arguments);
    urlChangeHandler();
  };
  
  const originalReplaceState = history.replaceState;
  history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    urlChangeHandler();
  };
  
  // setInterval ile periyodik URL kontrolü - güvenlik ağı olarak kullanılır
  setInterval(() => {
    if (lastUrl !== location.href) {
      lastUrl = location.href;
      urlChangeHandler();
    }
  }, 2000);
  
  // URL değişikliği işleyicisi
  function urlChangeHandler() {
    const currentUrl = location.href;
    if (lastUrl !== currentUrl) {
      console.log(`NetflixTogether: URL değişikliği algılandı: ${currentUrl}`);
      lastUrl = currentUrl;
      
      if (currentUrl.includes('netflix.com/watch')) {
        console.log('NetflixTogether: Netflix izleme sayfasına geçiş algılandı');
        setTimeout(() => {
          if (!videoElement || !chatContainer) {
            initializeExtension();
          }
        }, 1000); // Netflix içeriği yüklenene kadar kısa bir bekleme süresi
      }
    }
  }
}

// Mesaj alıcı
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('NetflixTogether: Mesaj alındı', message.type);
  
  // Mesaj yanıt gerektirir mi? (varsayılan: hayır)
  let needsResponse = false;
  
  // Yanıt göndermeye çalışırken oluşabilecek hataları yönet
  const safeRespond = (data) => {
    try {
      sendResponse(data);
    } catch (e) {
      console.warn('NetflixTogether: Yanıt gönderilirken hata:', e);
    }
  };
  
  try {
    switch (message.type) {
      case 'PING':
        // Basit ping kontrolü - hemen yanıt ver
        safeRespond({ success: true, pong: true });
        needsResponse = true;
        break;
        
      case 'SYNC_VIDEO_STATE':
        if (videoElement) {
          // Önce konumu senkronize et
          safeSetCurrentTime(message.currentTime);
          
          // Sonra oynatma/durdurma durumunu senkronize et
          if (message.videoState === 'playing') {
            safePlayVideo();
          } else {
            safePauseVideo();
          }
        }
        break;
        
      case 'NEW_CHAT_MESSAGE':
        addMessageToChat(message.userId, message.message, message.timestamp);
        // Bu mesaj için yanıt gönderme
        break;
        
      case 'CHECK_INTERFACE':
        safeRespond({
          hasVideo: !!videoElement,
          hasChat: !!chatContainer,
          url: window.location.href
        });
        needsResponse = true;
        break;
      
      case 'REINITIALIZE':
        console.log('NetflixTogether: Eklentiyi yeniden başlatma isteği alındı');
        initializeExtension();
        // Bu mesaj için yanıt göndermeye çalış ama zorunlu değil
        try {
          safeRespond({ success: true });
        } catch (e) {
          // Yanıt gönderirken hata olursa görmezden gel
        }
        break;
    }
  } catch (e) {
    console.error('NetflixTogether: Mesaj işleme hatası:', e);
    if (needsResponse) {
      safeRespond({ success: false, error: e.message });
    }
    
    // Extension context invalidated hatası mı kontrol et
    if (e.message && e.message.includes('Extension context invalidated')) {
      extensionActive = false;
      showReloadSuggestion();
    }
  }
  
  return needsResponse; // Sadece gerçekten yanıt bekliyorsa true döndür
});

// Ana eklenti başlatma fonksiyonu
function initializeExtension() {
  console.log('NetflixTogether: Eklenti başlatılıyor, URL:', window.location.href);
  
  // Önceki durumu kontrol et
  checkPreviousState();
  
  // Netflix video oynatıcısı sayfasında olduğumuzu kontrol et
  if (window.location.href.includes('netflix.com/watch')) {
    console.log('NetflixTogether: Netflix izleme sayfasında, arayüz oluşturuluyor');
    
    // Video elemanını bul - daha güvenilir bir şekilde
    findVideoElementWithRetry();
    
    // Sohbet arayüzünü oluştur
    createChatInterface();
    
    // URL'den oda kodunu kontrol et
    checkUrlForRoomCode();
  } else {
    console.log('NetflixTogether: Netflix izleme sayfasında değil, arayüz oluşturulmayacak');
  }
}

// Extension context invalidation durumunu izleme
window.addEventListener('unload', () => {
  // Sayfadan ayrılırken veya yenilenirken bu çalışır
  // Mevcut oda durumunu sakla
  try {
    if (roomId) {
      localStorage.setItem('netflixTogether_lastRoomId', roomId);
      localStorage.setItem('netflixTogether_lastPosition', videoElement?.currentTime || 0);
      localStorage.setItem('netflixTogether_timestamp', Date.now());
    }
  } catch (e) {
    console.error('NetflixTogether: Durum kaydetme hatası:', e);
  }
});

// Sayfanın hazır olma durumuna göre başlatma yap
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  // Sayfa zaten yüklenmişse hemen başlat
  initExtensionOnLoad();
} else {
  // Sayfa yüklendiğinde başlat
  window.addEventListener('DOMContentLoaded', initExtensionOnLoad);
  window.addEventListener('load', initExtensionOnLoad);
}
