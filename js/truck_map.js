class TruckCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.geojson = null;
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
    fetch('data/us-truck.json')
      .then(response => response.json())
      .then(data => {
        this.truckData = data;
        this.renderMap();
      })
      .catch(error => console.error('Error loading truck data:', error));
  }

  renderMap() {
    // 기존 GeoJSON 레이어 제거
    if (this.geojson) {
      this.map.removeLayer(this.geojson);
    }

    // GeoJSON 데이터 생성
    const geojsonFeatures = Object.keys(this.truckData).map(stateCode => {
      const stateData = this.truckData[stateCode];
      return {
        type: 'Feature',
        properties: {
          stateCode,
          ...stateData
        },
        geometry: {
          type: 'Point',
          coordinates: [this.getStateLongitude(stateCode), this.getStateLatitude(stateCode)]
        }
      };
    });

    // GeoJSON 레이어 생성 및 추가
    this.geojson = L.geoJSON(
      { type: 'FeatureCollection', features: geojsonFeatures },
      {
        pointToLayer: (feature, latlng) => {
          const color = this.getColor(feature.properties.inboundColor);
          return L.circleMarker(latlng, {
            radius: 8,
            fillColor: color,
            color: '#fff',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
          });
        },
        onEachFeature: (feature, layer) => {
          // 툴팁 바인딩 (호버 시 표시)
          layer.bindTooltip(this.createTooltipContent(feature.properties), {
            permanent: false,
            direction: 'top',
            className: 'truck-tooltip',
            offset: [0, -10]
          });
        }
      }
    ).addTo(this.map);

    // 지도 범위 조정
    this.map.fitBounds(this.geojson.getBounds());
  }

  getStateLatitude(stateCode) {
    // 간단한 예시 - 실제로는 정확한 좌표 데이터 사용
    const stateCoords = {
      'CA': 36.7783, 'TX': 31.9686, 'FL': 27.6648, 'NY': 43.2994,
      'IL': 40.6331, 'PA': 41.2033, 'OH': 40.4173, 'GA': 32.1656,
      // 다른 주들 추가...
    };
    return stateCoords[stateCode] || 39.8283; // 기본값
  }

  getStateLongitude(stateCode) {
    // 간단한 예시 - 실제로는 정확한 좌표 데이터 사용
    const stateCoords = {
      'CA': -119.4179, 'TX': -99.9018, 'FL': -81.5158, 'NY': -74.2179,
      'IL': -89.3985, 'PA': -77.1945, 'OH': -82.9071, 'GA': -82.9001,
      // 다른 주들 추가...
    };
    return stateCoords[stateCode] || -98.5795; // 기본값
  }

  getColor(value) {
    // 색상 범위: -3(빨강) ~ 0(노랑) ~ 3(초록)
    const hue = value > 0 ? 
      120 * (value / 3) : // 초록색 범위
      60 * (1 + value / 3); // 노랑-빨강 범위
    return `hsl(${hue}, 100%, 50%)`;
  }

  createTooltipContent(properties) {
    const { name, inboundDelay, outboundDelay, dwellInbound, dwellOutbound } = properties;
    
    const formatDelay = (delay) => {
      if (delay === null || delay === undefined) return 'N/A';
      return `${delay > 0 ? '+' : ''}${delay.toFixed(1)} days`;
    };

    return `
      <h4>${name}</h4>
      <div class="truck-metric-box">
        <strong>Inbound Delay</strong>
        <span class="${inboundDelay > 0 ? 'truck-negative' : 'truck-positive'}">
          ${formatDelay(inboundDelay)}
        </span>
      </div>
      <div class="truck-metric-box">
        <strong>Outbound Delay</strong>
        <span class="${outboundDelay > 0 ? 'truck-negative' : 'truck-positive'}">
          ${formatDelay(outboundDelay)}
        </span>
      </div>
      <div class="truck-metric-box">
        <strong>Dwell Time (Inbound)</strong>
        <span class="truck-normal-text">${dwellInbound?.toFixed(1) || 'N/A'} days</span>
      </div>
      <div class="truck-metric-box">
        <strong>Dwell Time (Outbound)</strong>
        <span class="truck-normal-text">${dwellOutbound?.toFixed(1) || 'N/A'} days</span>
      </div>
    `;
  }

  addResetButton() {
    const resetControl = L.control({ position: 'topright' });
    
    resetControl.onAdd = () => {
      const container = L.DomUtil.create('div', 'reset-control-container');
      const button = L.DomUtil.create('button', 'reset-btn', container);
      button.innerHTML = '<i class="fas fa-expand"></i> Reset View';
      button.onclick = () => {
        if (this.geojson) {
          this.map.fitBounds(this.geojson.getBounds());
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
    console.log('Searching truck locations:', { country, city, keyword });
    // 실제 구현에서는 필터링 로직 추가
  }
}
