class RailCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.markers = [];
    this.allData = []; // 모든 레일 데이터 저장
    this.filteredData = []; // 필터링된 데이터 저장
    this.initMap();
    this.loadData();
    this.addResetButton();
  }

  initMap() {
    this.map = L.map(this.mapId, {
      zoomControl: false,
      preferCanvas: true
    }).setView([37.8, -96], 4); // 임시 초기 뷰

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);
  }

  async loadData() {
    try {
      const response = await fetch('data/us-rail.json');
      const data = await response.json();
      
      // 데이터 구조에 따라 적절히 처리
      this.allData = Array.isArray(data) ? data : 
                    (data.data || []); // data.data가 있으면 사용
      
      this.filteredData = [...this.allData];
      this.renderMarkers();
      
      // 메타데이터에서 초기 뷰 설정 가능
      if (data.metadata?.initialView) {
        this.map.setView(
          [data.metadata.initialView.lat, data.metadata.initialView.lng],
          data.metadata.initialView.zoom
        );
      }
    } catch (error) {
      console.error('Error loading rail data:', error);
    }
  }

  renderMarkers(data = this.filteredData) {
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

    this.adjustMapView();
  }

  adjustMapView() {
    if (this.markers.length > 0) {
      const group = new L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds(), {
        padding: [50, 50], // 약간의 패딩 추가
        maxZoom: 8 // 최대 줌 레벨 제한
      });
    } else {
      this.map.setView([37.8, -96], 4); // 기본 뷰로 리셋
    }
  }

  searchLocations({ location, keyword }) {
    const locationLower = location?.toLowerCase();
    const keywordLower = keyword?.toLowerCase();
    
    this.filteredData = this.allData.filter(item => {
      // 위치 필터링
      if (locationLower) {
        const itemLocation = this.extractCityFromLocation(item.location)?.toLowerCase();
        if (!itemLocation || !itemLocation.includes(locationLower)) {
          return false;
        }
      }
      
      // 키워드 검색
      if (keywordLower) {
        const companyMatch = item.company?.toLowerCase().includes(keywordLower);
        const locationMatch = item.location?.toLowerCase().includes(keywordLower);
        return companyMatch || locationMatch;
      }
      
      return true;
    });

    this.renderMarkers();
  }

  extractCityFromLocation(location) {
    if (!location) return null;
    // 다양한 위치 형식 처리 (예: "Chicago, IL", "Chicago Yard", "Chicago")
    return location.split(',')[0].replace(/\s(Yard|Station|Depot)$/i, '').trim();
  }

  getRadius(score) {
    // 점수에 따라 반지름 결정 (5-15 범위)
    return Math.min(15, Math.max(5, 5 + (score || 0) * 2));
  }

  getColor(level) {
    if (!level) return '#3498db';
    switch (level.toLowerCase()) {
      case 'high': return '#e74c3c';
      case 'medium': return '#f39c12';
      case 'low': return '#2ecc71';
      default: return '#3498db';
    }
  }

  createTooltipContent(data) {
    return `
      <div class="rail-tooltip-content">
        <h4>${data.location || 'N/A'}</h4>
        <p><strong>Company:</strong> ${data.company || 'N/A'}</p>
        <p><strong>Congestion Level:</strong>
          <span style="color: ${this.getColor(data.congestion_level)}">
            ${data.congestion_level || 'N/A'}
          </span>
        </p>
        <p><strong>Score:</strong> ${data.congestion_score ?? 'N/A'}</p>
        ${data.date ? `<p><strong>Updated:</strong> ${data.date}</p>` : ''}
      </div>
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
      button.onclick = () => this.resetMapView();
      return container;
    };
    
    resetControl.addTo(this.map);
  }

  resetMapView() {
    if (this.markers.length > 0) {
      const group = new L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds(), {
        padding: [50, 50],
        maxZoom: 8
      });
    } else {
      this.map.setView([37.8, -96], 4);
    }
  }
}
