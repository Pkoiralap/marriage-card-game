export function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

export function getCardSVG(number, suit, color) {
    // Increase resolution for higher detail
    const width = 1024;
    const height = 1440;
    const fontSizeCorner = 350; // Increased significantly
    const fontSizeCenter = 950; // Increased significantly
    const strokeWidth = 12;
    const cornerOffset = 300; 
    
    let suitIcon = '';
    if (suit === 'HEART') suitIcon = '♥';
    else if (suit === 'DIAMOND') suitIcon = '♦';
    else if (suit === 'SPADE') suitIcon = '♠';
    else if (suit === 'CLUB') suitIcon = '♣';

    const fill = color === 'red' ? '#e74c3c' : '#2c3e50';
    
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect x="10" y="10" width="${width-20}" height="${height-20}" rx="80" ry="80" fill="white" stroke="#999" stroke-width="${strokeWidth}"/>
        <text x="150" y="${cornerOffset}" font-family="Arial, sans-serif" font-size="${fontSizeCorner}" font-weight="900" fill="${fill}" text-anchor="middle" stroke="${fill}" stroke-width="4">${number}</text>
        <text x="150" y="${cornerOffset + 250}" font-family="Arial, sans-serif" font-size="${fontSizeCorner}" fill="${fill}" text-anchor="middle" stroke="${fill}" stroke-width="4">${suitIcon}</text>
        <g transform="rotate(180 ${width/2} ${height/2})">
            <text x="150" y="${cornerOffset}" font-family="Arial, sans-serif" font-size="${fontSizeCorner}" font-weight="900" fill="${fill}" text-anchor="middle" stroke="${fill}" stroke-width="4">${number}</text>
            <text x="150" y="${cornerOffset + 250}" font-family="Arial, sans-serif" font-size="${fontSizeCorner}" fill="${fill}" text-anchor="middle" stroke="${fill}" stroke-width="4">${suitIcon}</text>
        </g>
        <text x="${width/2}" y="${height/2 + 300}" font-family="Arial, sans-serif" font-size="${fontSizeCenter}" fill="${fill}" text-anchor="middle" stroke="${fill}" stroke-width="8">${suitIcon}</text>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

export function getCardBackSVG() {
    const width = 1024;
    const height = 1440;
    const strokeWidth = 12;
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
            <linearGradient id="backGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#3498db;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#2980b9;stop-opacity:1" />
            </linearGradient>
        </defs>
        <rect x="10" y="10" width="${width-20}" height="${height-20}" rx="80" ry="80" fill="url(#backGrad)" stroke="#fff" stroke-width="${strokeWidth * 2}"/>
        <rect x="60" y="60" width="${width-120}" height="${height-120}" rx="60" ry="60" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="${strokeWidth}" stroke-dasharray="30,20"/>
        <circle cx="${width/2}" cy="${height/2}" r="200" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="${strokeWidth}"/>
        <path d="M${width/2-100} ${height/2} L${width/2+100} ${height/2} M${width/2} ${height/2-100} L${width/2} ${height/2+100}" stroke="white" stroke-width="${strokeWidth}"/>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

const textureCache = new Map();

export function createCardTexture(number, suit, color, renderer) {
    const cacheKey = `${number}_${suit}_${color}`;
    if (textureCache.has(cacheKey)) {
        return textureCache.get(cacheKey);
    }

    const texture = new THREE.TextureLoader().load(getCardSVG(number, suit, color));
    if (renderer) {
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    
    textureCache.set(cacheKey, texture);
    return texture;
}

export function createCardBackTexture(renderer) {
    const cacheKey = 'card_back';
    if (textureCache.has(cacheKey)) {
        return textureCache.get(cacheKey);
    }

    const texture = new THREE.TextureLoader().load(getCardBackSVG());
    if (renderer) {
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    
    textureCache.set(cacheKey, texture);
    return texture;
}
