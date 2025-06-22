class OceanCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.markers = [];
    this.initMap();
    this.loadData();
    this.addResetButton();
  }

  initMap() {
    // 지도 초기화 (전세계 보기)
    this.map = L.map(this.mapId, {
      zoomControl: false,
      preferCanvas: true
    }).setView([20, 0], 2);

    // 타일 레이어 추가
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(this.map);

    // 줌 컨트롤 추가
    L.control.zoom({ position: 'topright' }).addTo(this.map);
  }

  loadData() {
    fetch('data/global-ports.json')
      .then(response => response.json())
      .then(data => {
        this.portData = data;
        this.renderMarkers();
      })
      .catch(error => console.error('Error loading ocean data:', error));
  }

  renderMarkers() {
    // 기존 마커 제거
    this.clearMarkers();

    // 새로운 마커 추가
    this.markers = this.portData.map(item => {
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: this.getRadius(item.current_delay_days),
        fillColor: this.getColor(item.delay_level),
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      // 툴팁 바인딩 (호버 시 표시)
      marker.bindTooltip(this.createTooltipContent(item), {
        permanent: false,
        direction: 'top',
        className: 'ocean-tooltip',
        offset: [0, -10]
      });

      marker.addTo(this.map);
      return marker;
    });

    // 지도 범위 조정
    if (this.markers.length > 0) {
      const group = new L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds().pad(0.2)); // 약간의 패딩 추가
    }
  }

  getRadius(delayDays) {
    // 지연 일수에 따라 반지름 결정 (5-20 범위)
    if (!delayDays) return 5;
    return Math.min(20, Math.max(5, delayDays * 0.5));
  }

  getColor(level) {
    // 지연 수준에 따른 색상
    if (!level) return '#3498db';
    switch (level.toLowerCase()) {
      case 'extreme': return '#c0392b';
      case 'high': return '#e74c3c';
      case 'medium': return '#f39c12';
      case 'low': return '#2ecc71';
      default: return '#3498db';
    }
  }

  createTooltipContent(data) {
    return `
      <h4>${data.port}, ${data.country}</h4>
      <p><strong>Current Delay:</strong> 
        <span style="color: ${this.getColor(data.delay_level)}">
          ${data.current_delay || 'N/A'} (${data.current_delay_days || '0'} days)
        </span>
      </p>
      <p><strong>Weekly Median Delay:</strong> ${data.weekly_median_delay || 'N/A'} days</p>
      <p><strong>Monthly Max Delay:</strong> ${data.monthly_max_delay || 'N/A'} days</p>
      <p><strong>Port Code:</strong> ${data.port_code || 'N/A'}</p>
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
          this.map.fitBounds(group.getBounds().pad(0.2));
        } else {
          this.map.setView([20, 0], 2);
        }
      };
      return container;
    };
    
    resetControl.addTo(this.map);
  }

  searchLocations({ country, city, keyword }) {
    // 검색 기능 구현
    console.log('Searching ocean ports:', { country, city, keyword });
    // 실제 구현에서는 필터링 로직 추가
  }
}
