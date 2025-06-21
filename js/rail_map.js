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
    // 원 색상
    const circleColors = {
      'Very High': '#F44336',   // Red
      'High': '#FF9800',        // Orange
      'Average': '#FFC107',     // Amber
      'Low': '#8BC34A',         // Light Green
      'Very Low': '#4CAF50'     // Green
    };
    
    // 텍스트 색상
    const textColors = {
      'Very High': '#C62828',   // Dark Red
      'High': '#E65100',        // Dark Orange
      'Average': '#FF8F00',     // Dark Amber
      'Low': '#2E7D32',         // Dark Green
      'Very Low': '#1B5E20'     // Darker Green
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

window.RailCongestionMap = RailCongestionMap;
