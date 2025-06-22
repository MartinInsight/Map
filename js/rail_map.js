class RailCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.markers = [];
    this.initMap();
    this.loadData();
    this.addResetButton();
  }

  initMap() {
    // 지도 초기화
    this.map = L.map(this.mapId, {
      zoomControl: false,
      preferCanvas: true
    }).setView([37.8, -96], 4);

    // 타일 레이어 추가
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(this.map);

    // 줌 컨트롤 추가
    L.control.zoom({ position: 'topright' }).addTo(this.map);
  }

  loadData() {
    fetch('data/us-rail.json')
      .then(response => response.json())
      .then(data => {
        this.railData = data;
        this.renderMarkers();
      })
      .catch(error => console.error('Error loading rail data:', error));
  }

  renderMarkers() {
    // 기존 마커 제거
    this.clearMarkers();

    // 새로운 마커 추가
    this.markers = this.railData.map(item => {
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: this.getRadius(item.congestion_score),
        fillColor: this.getColor(item.congestion_level),
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      // 툴팁 바인딩 (호버 시 표시)
      marker.bindTooltip(this.createTooltipContent(item), {
        permanent: false,
        direction: 'top',
        className: 'rail-tooltip',
        offset: [0, -10]
      });

      marker.addTo(this.map);
      return marker;
    });

    // 지도 범위 조정
    if (this.markers.length > 0) {
      const group = new L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds());
    }
  }

  getRadius(score) {
    // 점수에 따라 반지름 결정 (5-15 범위)
    return 5 + (score || 0) * 2;
  }

  getColor(level) {
    // 혼잡도 수준에 따른 색상
    switch (level.toLowerCase()) {
      case 'high': return '#e74c3c';
      case 'medium': return '#f39c12';
      case 'low': return '#2ecc71';
      default: return '#3498db';
    }
  }

  createTooltipContent(data) {
    return `
      <h4>${data.location}</h4>
      <p><strong>Company:</strong> ${data.company || 'N/A'}</p>
      <p><strong>Congestion Level:</strong> 
        <span style="color: ${this.getColor(data.congestion_level)}">
          ${data.congestion_level || 'N/A'}
        </span>
      </p>
      <p><strong>Score:</strong> ${data.congestion_score || 'N/A'}</p>
      <p><strong>Last Updated:</strong> ${data.date || 'N/A'}</p>
    `;
  }

  clearMarkers() {
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];
  }

  addResetButton() {
    const resetControl = L.control({ position: 'topright' });
    
    resetControl.onAdd = () => {
      const container = L.DomUtil.create('div', 'reset-control-container');
      const button = L.DomUtil.create('button', 'reset-btn', container);
      button.innerHTML = '<i class="fas fa-expand"></i> Reset View';
      button.onclick = () => {
        if (this.markers.length > 0) {
          const group = new L.featureGroup(this.markers);
          this.map.fitBounds(group.getBounds());
        } else {
          this.map.setView([37.8, -96], 4);
        }
      };
      return container;
    };
    
    resetControl.addTo(this.map);
  }

  searchLocations({ country, city, keyword }) {
    // 검색 기능 구현
    console.log('Searching rail locations:', { country, city, keyword });
    // 실제 구현에서는 필터링 로직 추가
  }
}
