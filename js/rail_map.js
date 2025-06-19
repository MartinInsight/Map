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
      
      const infoControl = L.control({position: 'topleft'});
      
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

getColor(level) {
  // 원 색상과 툴팁 텍스트 색상을 완전히 동일하게 설정
  const colors = {
    'Very Low': '#4575b4',    // 진한 파랑
    'Low': '#74add1',         // 연한 파랑 (명확한 구분)
    'Average': '#abd9e9',     // 매우 연한 파랑 (회색 대신)
    'High': '#fdae61',        // 주황색
    'Very High': '#d73027'    // 진한 빨강
  };
  return colors[level] || '#999';
}

createPopupContent(data) {
  const level = data.congestion_level || 'Unknown';
  const color = this.getColor(level); // 원 색상을 가져와 텍스트에 적용

  return `
    <div class="rail-tooltip">
      <h4>${data.location || 'Unknown Location'}</h4>
      <p><strong>Company:</strong> ${data.company || 'Unknown'}</p>
      <p><strong>Congestion Level:</strong> 
        <span style="color: ${color}"> <!-- 원 색상과 동일하게 적용 -->
          ${level}
        </span>
      </p>
      <p><strong>Dwell Time:</strong> ${data.congestion_score?.toFixed(1) || 'N/A'} hours</p>
    </div>
  `;
}
