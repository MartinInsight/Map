class RailCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.markers = [];
    this.currentData = null;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    this.loadData();
  }

  async loadData() {
    try {
      const response = await fetch('data/us-rail.json');
      this.currentData = await response.json();
      this.renderMarkers();
    } catch (error) {
      console.error("Failed to load rail data:", error);
    }
  }

  renderMarkers() {
    // 기존 마커 제거
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];

    // 새 마커 추가
    this.currentData.forEach(item => {
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: this.getRadius(item.congestion_score),
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

  getRadius(score) {
    // 점수에 따라 원 크기 조정 (5-20px 범위)
    return Math.max(5, Math.min(20, 5 + score));
  }

  getColor(level) {
    // 혼잡도 수준에 따른 색상
    const colors = {
      'Very Low': '#4575b4',
      'Low': '#74add1',
      'Average': '#abd9e9',
      'High': '#fdae61',
      'Very High': '#d73027'
    };
    return colors[level] || '#999';
  }

  createPopupContent(data) {
    // 데이터가 없을 경우 기본값 설정
    const company = data.company || 'Unknown';
    const date = data.date ? new Date(data.date).toLocaleString() : 'N/A';
    const score = data.congestion_score !== undefined ? data.congestion_score : 'N/A';
    const level = data.congestion_level || 'Unknown';
  
    return `
      <div class="rail-tooltip">
        <h4>${data.location || 'Unknown Location'}</h4>
        <p><strong>Company:</strong> ${company}</p>
        <p><strong>Congestion Level:</strong> 
          <span class="congestion-${level.toLowerCase().replace(' ', '-')}">
            ${level}
          </span>
        </p>
        <p><strong>Score:</strong> ${score}</p>
        <p><small>Last updated: ${date}</small></p>
      </div>
    `;
  }
}
