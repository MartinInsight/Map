// js/rail_map.js
class RailCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.markers = [];
    this.currentData = null;
    this.lastUpdated = null;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    this.loadData();
  }

  async loadData() {
    try {
      const response = await fetch('data/us-rail.json');
      this.currentData = await response.json();
      if (this.currentData.length > 0) {
        this.lastUpdated = this.currentData[0].date;
      }
      this.renderMarkers();
      this.addLastUpdatedText();
    } catch (error) {
      console.error("Failed to load rail data:", error);
    }
  }

  addLastUpdatedText() {
    if (this.lastUpdated) {
      const date = new Date(this.lastUpdated);
      const formattedDate = `${date.getMonth()+1}-${date.getDate()}-${date.getFullYear()}`;
      
      const infoControl = L.control({ position: 'bottomleft' });
      
      infoControl.onAdd = () => {
        const div = L.DomUtil.create('div', 'last-updated-info');
        div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
        div.style.backgroundColor = 'white';
        div.style.padding = '5px 10px';
        div.style.borderRadius = '5px';
        div.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
        return div;
      };
      
      infoControl.addTo(this.map);
    }
  }

  renderMarkers() {
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];

    this.currentData.forEach(item => {
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: this.getRadiusByIndicator(item.indicator), // Indicator로 크기 결정
        fillColor: this.getColor(item.congestion_level),
        color: "#000",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      marker.bindPopup(this.createPopupContent(item));
      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }

  getRadiusByIndicator(indicator) {
    // Indicator 값에 따른 원 크기 (명확한 5단계 구분)
    if (indicator > 2) return 20;    // 제일 큼
    if (indicator > 1) return 16;    // 중간 큼
    if (indicator > -1) return 12;   // 중간
    if (indicator > -2) return 8;    // 중간 작음
    return 5;                        // 제일 작음
  }

  getColor(level, isText = false) {
    // 원 색상 (기존보다 약간 연하게)
    const circleColors = {
      'Very High': '#d62828',   // 원: 빨강
      'High': '#f88c2b',        // 원: 주황
      'Average': '#bcbcbc',     // 원: 회색
      'Low': '#5fa9f6',         // 원: 하늘
      'Very Low': '#004fc0'     // 원: 파랑
    };
    
    // 텍스트 색상 (원보다 더 진하게)
    const textColors = {
      'Very High': '#6b1414',   // 텍스트: 빨강
      'High': '#7c4616',        // 텍스트: 주황
      'Average': '#5e5e5e',     // 텍스트: 회색
      'Low': '#30557b',         // 텍스트: 하늘
      'Very Low': '#002860'     // 텍스트: 파랑
    };
  
    return isText ? textColors[level] : circleColors[level];
  }
  
  createPopupContent(data) {
    const level = data.congestion_level || 'Unknown';
    
    return `
      <div class="rail-tooltip">
        <h4>${data.location || 'Unknown Location'}</h4>
        <p><strong>Company:</strong> ${data.company || 'Unknown'}</p>
        <p><strong>Congestion Level:</strong> 
          <span style="color: ${this.getColor(level, true)}"> <!-- 텍스트용 진한 색상 -->
            ${level}
          </span>
        </p>
        <p><strong>Dwell Time:</strong> ${data.congestion_score?.toFixed(1) || 'N/A'} hours</p>
      </div>
    `;
  }
}
