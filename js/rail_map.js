class RailCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.markers = [];
    this.allRailData = []; // 모든 레일 데이터 저장
    this.filteredRailData = []; // 필터링된 레일 데이터 저장
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

  renderMarkers(data = this.filteredRailData) {
    this.clearMarkers();

    this.markers = data.map(item => {
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: this.getRadius(item.congestion_score),
        fillColor: this.getColor(item.congestion_level),
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      marker.bindTooltip(this.createTooltipContent(item), {
        permanent: false,
        direction: 'top',
        className: 'rail-tooltip',
        offset: [0, -10]
      });

      marker.addTo(this.map);
      return marker;
    });

    if (this.markers.length > 0) {
      const group = new L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds());
    }
  }

  searchLocations({ country, city, keyword }) {
    this.filteredRailData = this.allRailData.filter(item => {
      // 국가 필터 (미국만 있는 경우 생략 가능)
      if (country && country !== 'United States') return false;
      
      // 도시 필터
      if (city) {
        const locationCity = this.extractCityFromLocation(item.location);
        if (!locationCity || !locationCity.toLowerCase().includes(city.toLowerCase())) {
          return false;
        }
      }
      
      // 키워드 검색 (회사명 또는 위치에서 검색)
      if (keyword) {
        const searchTerm = keyword.toLowerCase();
        const companyMatch = item.company?.toLowerCase().includes(searchTerm);
        const locationMatch = item.location?.toLowerCase().includes(searchTerm);
        return companyMatch || locationMatch;
      }
      
      return true;
    });

    this.renderMarkers();
  }

  extractCityFromLocation(location) {
    if (!location) return null;
    // 위치 문자열에서 도시명 추출 (예: "Chicago, IL" -> "Chicago")
    return location.split(',')[0].trim();
  }

  // 데이터 로드 시 allRailData 저장
  loadData() {
    fetch('data/us-rail.json')
      .then(response => response.json())
      .then(data => {
        this.allRailData = data;
        this.filteredRailData = [...data];
        this.renderMarkers();
      })
      .catch(error => console.error('Error loading rail data:', error));
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
