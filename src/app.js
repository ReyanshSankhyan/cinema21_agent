// --- src/app.js ---
import { Conversation } from '@11labs/client';

let conversation = null;
let currentConversationId = null;
let lastTool = null;
let lastToolData = null;
let currentVideoType = 'idle'; // 'idle' or 'talk'
let isVideoPlaying = false;
let isToolVideoPlaying = false; // Track when tool video is playing

// Video URL mapping
const videoUrls = {
    idle: [
        'https://files.cekat.ai/idle01_WdhEBA.mp4',
        'https://files.cekat.ai/idle02_wzwOwW.mp4',
        'https://files.cekat.ai/idle03_hSgkmT.mp4',
        'https://files.cekat.ai/idle04_fvKDOd.mp4'
    ],
    talk: [
        'https://files.cekat.ai/talk01_zJhWdX.mp4',
        'https://files.cekat.ai/talk02_ZbJZsx.mp4',
        'https://files.cekat.ai/talk03_nGR0b5.mp4'
    ],
    food: 'https://files.cekat.ai/food01_hEuNQr.mp4',
    cart: 'https://files.cekat.ai/cart01_UNaXIH.mp4',
    movie: 'https://files.cekat.ai/movie01_CPEwjH.mp4',
    order: 'https://files.cekat.ai/order01_iXSyRa.mp4'
};

// Video loading system
let videosLoaded = 0;
let totalVideos = 0;
let allVideosLoaded = false;
const toolOrder = [
  'show_cinemas_showtimes',
  'show_food_items',
  'place_order',
  'update_cart',
  'play_movie_trailer',
  'set_movie_selection'
];
const toolToPanelId = {
  show_cinemas_showtimes: 'showtimes-info-panel',
  update_cart: 'cart-panel',
  show_food_items: 'food-info-panel',
  play_movie_trailer: 'trailer-panel',
  set_movie_selection: 'movie-selection-panel',
};

// Register client tool handlers as a plain object
const clientTools = {
  display_movie_info: async ({ movies }) => {
    // No-op legacy DOM update
    return { success: true };
  },
  display_showtimes_info: async ({ cinema_name, movies }) => {
    // No-op legacy DOM update
    return { success: true };
  },
  show_cinemas_showtimes: async ({ cinema_name, movies }) => {
    lastTool = 'show_cinemas_showtimes';
    lastToolData = { cinema_name, movies };
    lastToolDataMap['show_cinemas_showtimes'] = { cinema_name, movies };
    renderPanels();
    playMovieVideo(); // Play movie video animation
    return { success: true };
  },
  update_cart: async ({ cart_items }) => {
    lastTool = 'update_cart';
    lastToolData = { cart_items };
    lastToolDataMap['update_cart'] = { cart_items };
    renderPanels();
    playCartVideo(); // Play cart video animation
    return { success: true };
  },
  show_food_items: async ({ food_items }) => {
    lastTool = 'show_food_items';
    lastToolData = { food_items };
    lastToolDataMap['show_food_items'] = { food_items };
    renderPanels();
    playFoodVideo(); // Play food video animation
    return { success: true };
  },
  place_order: async () => {
    lastTool = 'place_order';
    lastToolData = {}; // No parameters needed
    lastToolDataMap['place_order'] = {};
    renderPanels();
    playOrderVideo(); // Play order video animation
    return { success: true };
  },
  play_movie_trailer: async ({ movie_code }) => {
    lastTool = 'play_movie_trailer';
    lastToolData = { movie_code };
    lastToolDataMap['play_movie_trailer'] = { movie_code };
    renderPanels();
    return { success: true };
  },
  set_movie_selection: async ({ movie_name, showtime }) => {
    lastTool = 'set_movie_selection';
    lastToolData = { movie_name, showtime };
    lastToolDataMap['set_movie_selection'] = { movie_name, showtime };
    renderPanels();
    return { success: true };
  },
};

function renderPanels() {
  const bottomPanel = document.getElementById('bottom-panel');
  const bottomPanelContent = document.getElementById('bottom-panel-content');
  const cartPanel = document.getElementById('cart-panel');
  
  // Split cart panel into movie selection and cart sections
  let cartPanelHTML = '';
  
  // Movie selection section (top) - always visible
  const movieSelectionData = lastToolDataMap['set_movie_selection'];
  cartPanelHTML += `
    <div style="border-bottom: 1px solid #ece7df; padding-bottom: 15px; margin-bottom: 15px;">
      <div style="font-weight: 600; color: #2d2a22; margin-bottom: 8px; font-size: 1rem;">Movie Selection</div>
      <div style="color: #555; font-size: 0.9em;">
        ${movieSelectionData ? 
          `<div><strong>Movie:</strong> ${movieSelectionData.movie_name}</div>
           <div><strong>Showtime:</strong> ${movieSelectionData.showtime}</div>` :
          `<div style="color: #aaa; font-style: italic;">No movie selected</div>`
        }
      </div>
    </div>
  `;
  
  // Cart section (bottom - taller)
  const cartData = lastToolDataMap['update_cart'] || (lastTool === 'update_cart' ? lastToolData : null);
  if (cartData && cartData.cart_items && cartData.cart_items.length > 0) {
    cartPanelHTML += renderToolContent('update_cart', cartData, false);
  } else {
    cartPanelHTML += '<div style="color:#aaa;text-align:center;padding-top:20px;">Cart Empty</div>';
  }
  
  cartPanel.innerHTML = cartPanelHTML;
  
  // Handle place_order tool - show in modal/popup
  if (lastTool === 'place_order' && lastToolData) {
    showOrderConfirmationModal(lastToolData);
    return;
  }
  
  // Handle play_movie_trailer tool - show video as full-screen overlay
  if (lastTool === 'play_movie_trailer' && lastToolData) {
    showTrailerModal(lastToolData);
    return;
  }
  
  // Show bottom panel for movie and food tools
  if (lastTool === 'show_cinemas_showtimes' || lastTool === 'show_food_items') {
    bottomPanel.style.display = 'block';
    bottomPanelContent.innerHTML = renderToolContent(lastTool, lastToolData, false);
  } else if (lastTool === 'update_cart') {
    // Keep bottom panel visible when cart is updated, but don't change its content
    // The bottom panel should retain its previous content (movies or food)
    if (bottomPanel.style.display === 'none') {
      // If bottom panel was hidden, check if we have previous movie or food data
      const previousMovieData = lastToolDataMap['show_cinemas_showtimes'];
      const previousFoodData = lastToolDataMap['show_food_items'];
      
      if (previousMovieData) {
        bottomPanel.style.display = 'block';
        bottomPanelContent.innerHTML = renderToolContent('show_cinemas_showtimes', previousMovieData, false);
      } else if (previousFoodData) {
        bottomPanel.style.display = 'block';
        bottomPanelContent.innerHTML = renderToolContent('show_food_items', previousFoodData, false);
      }
    }
  } else {
    // Hide bottom panel for other tools
    bottomPanel.style.display = 'none';
  }
}

function showOrderConfirmationModal(orderData) {
  const modal = document.getElementById('orderConfirmationModal');
  const modalContent = document.getElementById('orderConfirmationContent');
  
  // Get data from stored selections
  const movieSelectionData = lastToolDataMap['set_movie_selection'];
  const cartData = lastToolDataMap['update_cart'];
  
  let modalHtml = `
    <div style="text-align: center; padding: 30px; max-width: 500px; margin: 0 auto;">
      <div style="margin-bottom: 25px;">
        <div style="font-size: 48px; margin-bottom: 15px;">🎬</div>
        <h2 style="color: #2d2a22; margin: 0; font-size: 24px; font-weight: 600;">Order Confirmed!</h2>
        <p style="color: #666; margin: 8px 0 0 0; font-size: 14px;">Your booking has been successfully placed</p>
      </div>
      
      <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 16px; padding: 20px; margin-bottom: 20px; border: 1px solid #dee2e6;">
        <h3 style="color: #2d2a22; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Movie Details</h3>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0;">
          <span style="color: #555; font-weight: 500;">Movie:</span>
          <span style="color: #2d2a22; font-weight: 600;">${movieSelectionData ? movieSelectionData.movie_name : 'N/A'}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0;">
          <span style="color: #555; font-weight: 500;">Showtime:</span>
          <span style="color: #2d2a22; font-weight: 600;">${movieSelectionData ? movieSelectionData.showtime : 'N/A'}</span>
        </div>
      </div>
  `;
  
  if (cartData && cartData.cart_items && cartData.cart_items.length > 0) {
    modalHtml += `
      <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 16px; padding: 20px; margin-bottom: 20px; border: 1px solid #dee2e6;">
        <h3 style="color: #2d2a22; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Food Order</h3>
        <div style="text-align: left;">
    `;
    
    let totalPrice = 0;
    cartData.cart_items.forEach(item => {
      const itemTotal = item.quantity * item.price;
      totalPrice += itemTotal;
      modalHtml += `
        <div style="display: flex; justify-content: space-between; align-items: center; margin: 10px 0; padding: 8px 12px; background: rgba(255,255,255,0.7); border-radius: 8px;">
          <span style="color: #2d2a22; font-weight: 500;">${item.name} × ${item.quantity}</span>
          <span style="color: #2d2a22; font-weight: 600;">Rp${itemTotal.toLocaleString()}</span>
        </div>
      `;
    });
    
    modalHtml += `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding: 12px 0; border-top: 2px solid #dee2e6; font-weight: bold; font-size: 16px;">
            <span style="color: #2d2a22;">Total:</span>
            <span style="color: #2d2a22;">Rp${totalPrice.toLocaleString()}</span>
          </div>
        </div>
      </div>
    `;
  }
  
  modalHtml += `
      <div style="background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); border-radius: 16px; padding: 20px; margin-bottom: 25px; border: 1px solid #c3e6cb;">
        <h4 style="color: #155724; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">Pickup Information</h4>
        <p style="margin: 0; color: #155724; font-weight: 500; line-height: 1.4;">
          Your movie will play at <strong>Studio 1</strong> at ${movieSelectionData ? movieSelectionData.showtime : 'N/A'}, and you can pick up your order at <strong>Pickup 3</strong>.
        </p>
      </div>
      
      <button onclick="window.closeOrderConfirmationModal()" style="
        background: linear-gradient(135deg, #7b8c5a 0%, #6c7b4a 100%);
        color: white;
        border: none;
        padding: 14px 32px;
        border-radius: 12px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(123, 140, 90, 0.3);
        transition: all 0.2s ease;
      " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(123, 140, 90, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(123, 140, 90, 0.3)'">
        Close
      </button>
    </div>
  `;
  
  modalContent.innerHTML = modalHtml;
  modal.style.display = 'block';
}

function closeOrderConfirmationModal() {
  const modal = document.getElementById('orderConfirmationModal');
  modal.style.display = 'none';
}

// Make the function globally accessible
window.closeOrderConfirmationModal = closeOrderConfirmationModal;

function showTrailerModal(trailerData) {
  // Remove any existing trailer modal first
  closeTrailerModal();
  
  const { movie_code } = trailerData;
  const trailerUrl = `https://nos.jkt-1.neo.id/media.cinema21.co.id/movie-trailer/${movie_code}.mp4`;
  
  // Create modal HTML
  const modalHtml = `
    <div id="trailerModal" style="
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(0, 0, 0, 0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    ">
      <div style="
        position: relative;
        width: 100vw;
        height: 100vh;
        background: #000;
        overflow: hidden;
      ">
        <button onclick="closeTrailerModal()" style="
          position: absolute;
          top: 20px;
          right: 20px;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          border: none;
          border-radius: 50%;
          width: 60px;
          height: 60px;
          font-size: 28px;
          cursor: pointer;
          z-index: 10001;
          display: flex;
          align-items: center;
          justify-content: center;
        ">×</button>
        <video controls autoplay style="
          width: 100vw;
          height: 100vh;
          object-fit: cover;
        ">
          <source src="${trailerUrl}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  `;
  
  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeTrailerModal() {
  const modal = document.getElementById('trailerModal');
  if (modal) {
    modal.remove();
  }
}

// Make the function globally accessible
window.closeTrailerModal = closeTrailerModal;



// Video loading system
function loadAllVideos() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.querySelector('.loading-text');
    
    // Calculate total videos to load
    totalVideos = videoUrls.idle.length + videoUrls.talk.length + 4; // +4 for tool videos
    
    // Create video elements for preloading
    const videoElements = [];
    
    // Load idle videos
    videoUrls.idle.forEach(url => {
        const video = document.createElement('video');
        video.src = url;
        video.preload = 'auto';
        video.muted = true;
        videoElements.push(video);
    });
    
    // Load talk videos
    videoUrls.talk.forEach(url => {
        const video = document.createElement('video');
        video.src = url;
        video.preload = 'auto';
        video.muted = true;
        videoElements.push(video);
    });
    
    // Load tool videos
    const toolVideoUrls = [videoUrls.food, videoUrls.cart, videoUrls.movie, videoUrls.order];
    toolVideoUrls.forEach(url => {
        const video = document.createElement('video');
        video.src = url;
        video.preload = 'auto';
        video.muted = true;
        videoElements.push(video);
    });
    
    // Track loading progress
    videoElements.forEach(video => {
        video.addEventListener('loadeddata', () => {
            videosLoaded++;
            const progress = Math.round((videosLoaded / totalVideos) * 100);
            loadingText.textContent = `Loading videos... ${progress}%`;
            
            if (videosLoaded >= totalVideos) {
                allVideosLoaded = true;
                loadingOverlay.style.display = 'none';
                // Enable the start button
                updateStartButton(true);
            }
        });
        
        video.addEventListener('error', () => {
            console.error('Failed to load video:', video.src);
            videosLoaded++;
            if (videosLoaded >= totalVideos) {
                allVideosLoaded = true;
                loadingOverlay.style.display = 'none';
                updateStartButton(true);
            }
        });
    });
}

// Video avatar system
function getRandomVideo(type) {
    if (type === 'talk') {
        const randomIndex = Math.floor(Math.random() * videoUrls.talk.length);
        return videoUrls.talk[randomIndex];
    } else {
        const randomIndex = Math.floor(Math.random() * videoUrls.idle.length);
        return videoUrls.idle[randomIndex];
    }
}

function playVideo(videoType) {
    const videoElement = document.getElementById('avatar-video');
    if (!videoElement) return;
    
    // Don't interrupt tool videos
    if (isToolVideoPlaying) return;
    
    // Always change video for instant transitions
    currentVideoType = videoType;
    const videoSrc = getRandomVideo(videoType);
    
    // Force immediate video change
    videoElement.pause();
    videoElement.src = videoSrc;
    videoElement.load();
    playVideoWithRetry(videoElement);
}

function playVideoWithRetry(videoElement, retryCount = 0) {
    const maxRetries = 3;
    
    videoElement.play().then(() => {
        isVideoPlaying = true;
    }).catch(error => {
        console.error('Error playing video:', error);
        
        // Retry if it's a power-saving interruption and we haven't exceeded retries
        if (error.name === 'AbortError' && retryCount < maxRetries) {
            console.log(`Retrying video playback (attempt ${retryCount + 1}/${maxRetries})`);
            setTimeout(() => {
                playVideoWithRetry(videoElement, retryCount + 1);
            }, 100); // Small delay before retry
        }
    });
}

function updateAvatarVideo(isSpeaking) {
    if (isSpeaking) {
        playVideo('talk');
    } else {
        playVideo('idle');
    }
}

async function playFoodVideo() {
    const videoElement = document.getElementById('avatar-video');
    if (!videoElement) return;
    
    // Store current state
    const wasSpeaking = currentVideoType === 'talk';
    
    // Set tool video flag
    isToolVideoPlaying = true;
    
    // Play food video
    videoElement.src = videoUrls.food;
    videoElement.load();
    await playVideoWithRetryAsync(videoElement);
    
    // Wait for video to finish
    await new Promise((resolve) => {
        videoElement.addEventListener('ended', resolve, { once: true });
    });
    
    // Clear tool video flag
    isToolVideoPlaying = false;
    
    // Return to previous state
    if (wasSpeaking) {
        playVideo('talk');
    } else {
        playVideo('idle');
    }
}

async function playVideoWithRetryAsync(videoElement, retryCount = 0) {
    const maxRetries = 3;
    
    try {
        await videoElement.play();
    } catch (error) {
        console.error('Error playing video:', error);
        
        // Retry if it's a power-saving interruption and we haven't exceeded retries
        if (error.name === 'AbortError' && retryCount < maxRetries) {
            console.log(`Retrying video playback (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay before retry
            return playVideoWithRetryAsync(videoElement, retryCount + 1);
        }
        throw error; // Re-throw if we can't retry
    }
}

async function playCartVideo() {
    const videoElement = document.getElementById('avatar-video');
    if (!videoElement) return;
    
    // Store current state
    const wasSpeaking = currentVideoType === 'talk';
    
    // Set tool video flag
    isToolVideoPlaying = true;
    
    // Play cart video
    videoElement.src = videoUrls.cart;
    videoElement.load();
    await playVideoWithRetryAsync(videoElement);
    
    // Wait for video to finish
    await new Promise((resolve) => {
        videoElement.addEventListener('ended', resolve, { once: true });
    });
    
    // Clear tool video flag
    isToolVideoPlaying = false;
    
    // Return to previous state
    if (wasSpeaking) {
        playVideo('talk');
    } else {
        playVideo('idle');
    }
}

async function playMovieVideo() {
    const videoElement = document.getElementById('avatar-video');
    if (!videoElement) return;
    
    // Store current state
    const wasSpeaking = currentVideoType === 'talk';
    
    // Set tool video flag
    isToolVideoPlaying = true;
    
    // Play movie video
    videoElement.src = videoUrls.movie;
    videoElement.load();
    await playVideoWithRetryAsync(videoElement);
    
    // Wait for video to finish
    await new Promise((resolve) => {
        videoElement.addEventListener('ended', resolve, { once: true });
    });
    
    // Clear tool video flag
    isToolVideoPlaying = false;
    
    // Return to previous state
    if (wasSpeaking) {
        playVideo('talk');
    } else {
        playVideo('idle');
    }
}

async function playOrderVideo() {
    const videoElement = document.getElementById('avatar-video');
    if (!videoElement) return;
    
    // Store current state
    const wasSpeaking = currentVideoType === 'talk';
    
    // Set tool video flag
    isToolVideoPlaying = true;
    
    // Play order video
    videoElement.src = videoUrls.order;
    videoElement.load();
    await playVideoWithRetryAsync(videoElement);
    
    // Wait for video to finish
    await new Promise((resolve) => {
        videoElement.addEventListener('ended', resolve, { once: true });
    });
    
    // Clear tool video flag
    isToolVideoPlaying = false;
    
    // Return to previous state
    if (wasSpeaking) {
        playVideo('talk');
    } else {
        playVideo('idle');
    }
}

const lastToolDataMap = {};

// Initialize video avatar system
document.addEventListener('DOMContentLoaded', function() {
    const videoElement = document.getElementById('avatar-video');
    if (videoElement) {
        // Handle video ended event to loop videos
        videoElement.addEventListener('ended', function() {
            // Only loop if not a tool video
            if (!isToolVideoPlaying) {
                // Play the same video again for seamless looping
                videoElement.play().catch(error => {
                    console.error('Error replaying video:', error);
                });
            }
        });
        
        // Start with idle video
        updateAvatarVideo(false);
    }
});
function renderToolContent(tool, data, isMain) {
  // Render content for each tool, styled for main or sub panel
  if (tool === 'show_cinemas_showtimes' || tool === 'display_showtimes_info') {
    const { cinema_name, movies } = data;
    let html = `<div class='tool-title' style='font-size:1.1rem;font-weight:700;margin-bottom:10px;'>Showtimes</div>`;
    html += '<div style="display:flex;gap:20px;margin-top:12px;">';
    for (const movie of (movies || [])) {
      html += `<div style="min-width:200px;max-width:250px;padding:12px;border:1px solid #eee;border-radius:8px;background:#faf9f6;display:inline-block;height:140px;">
        <div style="display:flex;align-items:center;gap:12px;height:100%;">
          ${movie.image_url ? `<img src="${movie.image_url}" alt="${movie.movie_name}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0;">` : ''}
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;">
            <div style="font-weight:600;color:#2d2a22;margin-bottom:8px;font-size:0.9em;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${movie.movie_name}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">`;
      for (const showtime of (movie.showtimes || [])) {
        html += `<span style="display:inline-block;padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;font-size:0.9em;">${showtime}</span>`;
      }
      html += `</div></div></div></div>`;
    }
    html += '</div>';
    return html;
  }
  if (tool === 'update_cart') {
    const cart_items = data.cart_items || [];
    let html = `<div class='tool-title' style='font-size:${isMain ? '2rem':'1.1rem'};font-weight:700;margin-bottom:10px;'>Your Cart</div>`;
    if (!Array.isArray(cart_items) || cart_items.length === 0) {
      html += '<div style="color:#aaa;">Your cart is empty.</div>';
      return html;
    }
    const cartMap = new Map();
    for (const item of cart_items) {
      if (!item.name || typeof item.price !== 'number' || typeof item.quantity !== 'number') continue;
      if (cartMap.has(item.name)) {
        const existing = cartMap.get(item.name);
        existing.quantity += item.quantity;
      } else {
        cartMap.set(item.name, { ...item });
      }
    }
    let total = 0;
    html += '<ul style="list-style:none;padding:0;">';
    for (const item of cartMap.values()) {
      html += `<li style="margin-bottom:8px;padding:6px;border:1px solid #eee;border-radius:8px;display:flex;justify-content:space-between;align-items:center;background:#faf9f6;">
        <span><b>${item.name}</b> x${item.quantity}</span>
        <span>Rp${(item.price * item.quantity).toLocaleString()}</span>
      </li>`;
      total += item.price * item.quantity;
    }
    html += `</ul><div style='margin-top:10px;font-weight:bold;font-size:1.1em;text-align:right;'>Total: Rp${total.toLocaleString()}</div>`;
    return html;
  }
  if (tool === 'show_food_items') {
    const food_items = data.food_items || [];
    let html = `<div class='tool-title' style='font-size:1.1rem;font-weight:700;margin-bottom:10px;'>Food Menu</div><div style="display:flex;gap:20px;">`;
    for (const item of food_items.slice(0, 10)) {
      html += `<div style="min-width:200px;max-width:250px;padding:12px;border:1px solid #eee;border-radius:8px;background:#faf9f6;display:inline-block;height:140px;">
        <div style="display:flex;align-items:center;gap:12px;height:100%;">
          ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0;">` : ''}
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;">
            <b style="font-size:0.9em;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.2;">${item.name}</b>
            <span style='color:#7b8c5a;font-size:0.9em;margin-top:8px;'>Price: Rp${item.price.toLocaleString()}</span>
          </div>
        </div>
      </div>`;
    }
    html += '</div>';
    return html;
  }

  return '<div style="color:#aaa;">No data</div>';
}

// Patch client tool handlers to update lastTool and lastToolDataMap
const originalClientTools = { ...clientTools };
['show_cinemas_showtimes', 'update_cart', 'show_food_items', 'play_movie_trailer', 'set_movie_selection'].forEach(tool => {
  clientTools[tool] = async (data) => {
    lastTool = tool;
    lastToolData = data;
    lastToolDataMap[tool] = data;
    renderPanels();
    return originalClientTools[tool] ? await originalClientTools[tool](data) : { success: true };
  };
});

// Initial render
renderPanels();

// --- Main Controls and Modal Logic ---

function updateStatus(isConnected) {
    const statusElement = document.getElementById('connectionStatus');
    statusElement.textContent = isConnected ? 'Connected' : 'Disconnected';
    statusElement.classList.toggle('connected', isConnected);
}

function updateSpeakingStatus(mode) {
    const statusElement = document.getElementById('speakingStatus');
    // Update based on the exact mode string we receive
    const isSpeaking = mode.mode === 'speaking';
    statusElement.textContent = isSpeaking ? 'Agent Speaking' : 'Agent Silent';
    statusElement.classList.toggle('speaking', isSpeaking);
    
    // Update video avatar based on speaking state
    updateAvatarVideo(isSpeaking);
    
    console.log('Speaking status updated:', { mode, isSpeaking }); // Debug log
}

function updateStartButton(isActive) {
    const startButton = document.getElementById('startButton');
    if (startButton) {
        if (isActive) {
            startButton.textContent = 'End Conversation';
            startButton.classList.add('end');
        } else {
            startButton.textContent = 'Start Conversation';
            startButton.classList.remove('end');
        }
        startButton.disabled = !isActive;
    }
}

async function startOrEndConversation() {
    if (!conversation) {
        // Start conversation
        try {
            const hasPermission = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!hasPermission) {
                alert('Microphone permission is required for the conversation.');
                return;
            }
            const signedUrlResponse = await fetch('/api/signed-url');
            const signedUrlData = await signedUrlResponse.json();
            const signedUrl = signedUrlData.signedUrl;
            conversation = await Conversation.startSession({
                signedUrl: signedUrl,
                clientTools,
                onConnect: () => {
                    updateStatus(true);
                    updateStartButton(true);
                },
                onDisconnect: () => {
                    updateStatus(false);
                    updateStartButton(false);
                    updateSpeakingStatus({ mode: 'listening' });
                },
                onError: (error) => {
                    alert('An error occurred during the conversation.');
                },
                onModeChange: (mode) => {
                    updateSpeakingStatus(mode);
                }
            });
            updateStartButton(true);
        } catch (error) {
            alert('Failed to start conversation. Please try again.');
            updateStartButton(false);
        }
    } else {
        // End conversation
        try {
            await conversation.endSession();
            conversation = null;
            updateStartButton(false);
            showConversationSummary();
        } catch (error) {
            alert('Failed to end conversation.');
        }
    }
}

async function showConversationSummary() {
    const modal = document.getElementById('conversationSummaryModal');
    const content = document.getElementById('conversationSummaryContent');
    modal.style.display = 'block';
    content.textContent = 'Loading...';
    try {
        const response = await fetch(`/api/conversation-summary`);
        if (!response.ok) throw new Error('Failed to fetch summary');
        const data = await response.json();
        let html = '';
        if (data.transcriptSummary) {
            html += `<b>Transcript Summary:</b><br>${data.transcriptSummary}<br><br>`;
        }
        if (data.summary) {
            html += `<b>Summary:</b><br>${data.summary}<br><br>`;
        }
        if (data.transcript) {
            html += '<b>Transcript:</b><br>' + data.transcript.map(turn => `<b>${turn.role}:</b> ${turn.message}`).join('<br>');
        }
        if (!html) {
            html = 'No summary or transcript available.';
        }
        content.innerHTML = html;
    } catch (err) {
        content.textContent = 'Error loading summary: ' + err.message;
    }
}

document.getElementById('closeSummaryModal').onclick = function() {
    document.getElementById('conversationSummaryModal').style.display = 'none';
};

// Initialize video loading when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Set start button to initial state (enabled but showing "Start Conversation")
    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.textContent = 'Start Conversation';
        startButton.classList.remove('end');
        startButton.disabled = true; // Disabled until videos load
    }
    // Start loading all videos
    loadAllVideos();
});

// Also ensure button is set correctly when window loads
window.addEventListener('load', function() {
    const startButton = document.getElementById('startButton');
    if (startButton && !conversation) {
        startButton.textContent = 'Start Conversation';
        startButton.classList.remove('end');
    }
});
window.onclick = function(event) {
    const modal = document.getElementById('conversationSummaryModal');
    if (event.target === modal) {
        modal.style.display = 'none';
    }
};

async function deleteAgent() {
    const deleteButton = document.getElementById('deleteAgentButton');
    deleteButton.disabled = true;
    try {
        const response = await fetch('/api/agent', { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete agent');
        alert('Agent deleted successfully. The page will reload.');
        window.location.reload();
    } catch (error) {
        alert('Failed to delete agent: ' + error.message);
        deleteButton.disabled = false;
    }
}

document.getElementById('startButton').addEventListener('click', startOrEndConversation);

document.getElementById('deleteAllButton').addEventListener('click', async () => {
    const btn = document.getElementById('deleteAllButton');
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    try {
        const response = await fetch('/api/delete-all', { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete all');
        alert('All agents, voices, and tools deleted. The page will reload.');
        window.location.reload();
    } catch (error) {
        alert('Failed to delete all: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Delete All';
    }
});

// Menu functionality
const menuButton = document.getElementById('menuButton');
const menuBox = document.getElementById('menuBox');

menuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    menuBox.classList.toggle('show');
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (!menuBox.contains(e.target) && !menuButton.contains(e.target)) {
        menuBox.classList.remove('show');
    }
});

window.addEventListener('error', function(event) {
    console.error('Global error:', event.error);
});

