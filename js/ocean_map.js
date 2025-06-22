class OceanCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.markers = [];
    this.allData = []; // 모든 항구 데이터 저장
    this.filteredData = []; // 필터링된 데이터 저장
    this.initMap();
    this.loadData();
    this.addResetButton();
  }

  initMap() {
    this.map = L.map(this.mapId, {
      zoomControl: false,
      preferCanvas: true,
      worldCopyJump: true // 세계지도 순환 표시
    }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
      noWrap: true // 타일 래핑 방지
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);
  }

  async loadData() {
    try {
      const response = await fetch('data/global-ports.json');
      const data = await response.json();
      
      // 데이터 구조 유연성 처리
      this.allData = Array.isArray(data) ? data : 
                   (data.data || []);
      
      this.filteredData = [...this.allData];
      this.renderMarkers();
      
      // 초기 뷰 설정 (데이터 기반)
      if (this.allData.length > 0) {
        this.adjustMapView();
      }
    } catch (error) {
      console.error('Error loading ocean data:', error);
    }
  }

  renderMarkers(data = this.filteredData) {
    this.clearMarkers();

    this.markers = data.map(item => {
      // 데이터 유효성 검사
      if (!item.lat || !item.lng) return null;

      const marker = L.circleMarker([item.lat, item.lng], {
        radius: this.getRadius(item.current_delay_days),
        fillColor: this.getColor(item.delay_level),
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      marker.bindTooltip(this.createTooltipContent(item), {
        permanent: false,
        direction: 'top',
        className: 'ocean-tooltip',
        offset: [0, -10]
      });

      marker.addTo(this.map);
      return marker;
    }).filter(Boolean); // null 값 제거

    this.adjustMapView();
  }

  adjustMapView() {
    if (this.markers.length > 0) {
      const group = new L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds(), {
        padding: [50, 50], // 패딩 추가
        maxZoom: 8 // 최대 줌 제한
      });
    } else {
      this.map.setView([20, 0], 2); // 기본 뷰
    }
  }

  searchLocations({ country, location, keyword }) {
    const countryLower = country?.toLowerCase();
    const locationLower = location?.toLowerCase();
    const keywordLower = keyword?.toLowerCase();

    this.filteredData = this.allData.filter(item => {
      // 국가 필터
      if (countryLower && !item.country?.toLowerCase().includes(countryLower)) {
        return false;
      }
      
      // 위치 필터 (항구명 또는 도시명)
      if (locationLower) {
        const portName = item.port?.toLowerCase();
        const cityName = this.extractCityFromPort(item.port)?.toLowerCase();
        if (!portName?.includes(locationLower) && !cityName?.includes(locationLower)) {
          return false;
        }
      }
      
      // 키워드 검색
      if (keywordLower) {
        const matches = [
          item.port,
          item.country,
          item.port_code,
          item.current_delay
        ].some(field => field?.toLowerCase().includes(keywordLower));
        
        if (!matches) return false;
      }
      
      return true;
    });

    this.renderMarkers();
  }

  extractCityFromPort(portName) {
    if (!portName) return null;
    // 다양한 항구 이름 형식 처리
    return portName
      .replace(/Port of|Port|Harbor|Terminal/gi, '')
      .replace(/[,-].*$/, '') // 쉼표나 하이픈 이후 제거
      .trim();
  }

  getRadius(delayDays) {
    // 지연 일수에 따라 반지름 결정 (5-20 범위)
    const days = Number(delayDays) || 0;
    return Math.min(20, Math.max(5, 5 + days * 0.5));
  }

  getColor(level) {
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
      <div class="ocean-tooltip-content">
        <h4>${data.port || 'N/A'}, ${data.country || 'N/A'}</h4>
        <p><strong>Current Delay:</strong>
          <span style="color: ${this.getColor(data.delay_level)}">
            ${data.current_delay || 'N/A'} (${data.current_delay_days || '0'} days)
          </span>
        </p>
        <p><strong>Weekly Median:</strong> ${data.weekly_median_delay ?? 'N/A'} days</p>
        <p><strong>Monthly Max:</strong> ${data.monthly_max_delay ?? 'N/A'} days</p>
        ${data.port_code ? `<p><strong>Port Code:</strong> ${data.port_code}</p>` : ''}
        ${data.date ? `<p><strong>Updated:</strong> ${data.date}</p>` : ''}
      </div>
    `;
  }

  clearMarkers() {
    this.markers.forEach(marker => marker && this.map.removeLayer(marker));
    this.markers = [];
  }

  addResetButton() {
    const resetControl = L.control({ position: 'topright' });
    
    resetControl.onAdd = () => {
      const container = L.DomUtil.create('div', 'reset-control-container');
      const button = L.DomUtil.create('button', 'reset-btn', container);
      button.innerHTML = '<i class="fas fa-expand"></i> Reset View';
      button.onclick = () => this.resetMapView();
      return container;
    };
    
    resetControl.addTo(this.map);
  }

  resetMapView() {
    if (this.filteredData.length > 0) {
      this.renderMarkers(); // 필터링된 데이터로 뷰 재조정
    } else {
      this.map.setView([20, 0], 2);
    }
  }
}
