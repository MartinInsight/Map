class OceanCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.markers = [];
    this.allPortData = []; // 모든 항구 데이터 저장
    this.filteredPortData = []; // 필터링된 항구 데이터 저장
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

  renderMarkers(data = this.filteredPortData) {
    this.clearMarkers();

    this.markers = data.map(item => {
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
    });

    if (this.markers.length > 0) {
      const group = new L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds().pad(0.2));
    }
  }

  searchLocations({ country, city, keyword }) {
    this.filteredPortData = this.allPortData.filter(item => {
      // 국가 필터
      if (country && item.country && !item.country.toLowerCase().includes(country.toLowerCase())) {
        return false;
      }
      
      // 도시 필터 (항구 위치에서 도시명 추정)
      if (city) {
        const portCity = this.extractCityFromPort(item.port);
        if (!portCity || !portCity.toLowerCase().includes(city.toLowerCase())) {
          return false;
        }
      }
      
      // 키워드 검색 (항구명, 국가, 코드 등에서 검색)
      if (keyword) {
        const searchTerm = keyword.toLowerCase();
        const portMatch = item.port?.toLowerCase().includes(searchTerm);
        const countryMatch = item.country?.toLowerCase().includes(searchTerm);
        const codeMatch = item.port_code?.toLowerCase().includes(searchTerm);
        return portMatch || countryMatch || codeMatch;
      }
      
      return true;
    });

    this.renderMarkers();
  }

  extractCityFromPort(portName) {
    if (!portName) return null;
    // 항구 이름에서 도시명 추출 (예: "Port of Los Angeles" -> "Los Angeles")
    return portName.replace(/Port of/i, '').trim();
  }

  // 데이터 로드 시 allPortData 저장
  loadData() {
    fetch('data/global-ports.json')
      .then(response => response.json())
      .then(data => {
        this.allPortData = data;
        this.filteredPortData = [...data];
        this.renderMarkers();
      })
      .catch(error => console.error('Error loading ocean data:', error));
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
