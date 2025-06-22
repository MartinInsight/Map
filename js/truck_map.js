class TruckCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.stateData = {}; // 주 데이터 저장 (위도/경도 포함)
    this.truckData = {}; // 트럭 데이터 저장
    this.geojson = null;
    this.initMap();
    this.loadData();
    this.addResetButton();
  }

  async loadData() {
    try {
      // 주 데이터 로드 (위도/경도 포함)
      const statesRes = await fetch('data/us-states.json');
      const statesGeoJSON = await statesRes.json();
      
      // 트럭 데이터 로드
      const truckRes = await fetch('data/us-truck.json');
      const truckData = await truckRes.json();
      
      // 주 데이터와 트럭 데이터 병합
      this.stateData = statesGeoJSON.features.reduce((acc, feature) => {
        const stateCode = feature.id;
        if (truckData[stateCode]) {
          // 주의 중심점 계산 (간단한 버전)
          const coordinates = feature.geometry.coordinates[0][0];
          const center = coordinates.reduce((acc, coord) => {
            return [acc[0] + coord[0], acc[1] + coord[1]];
          }, [0, 0]);
          center[0] /= coordinates.length;
          center[1] /= coordinates.length;
          
          acc[stateCode] = {
            ...truckData[stateCode],
            lat: center[1],
            lng: center[0],
            name: feature.properties.name
          };
        }
        return acc;
      }, {});
      
      this.renderMap();
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  renderMap() {
    if (this.geojson) {
      this.map.removeLayer(this.geojson);
    }

    const geojsonFeatures = Object.keys(this.stateData).map(stateCode => {
      const stateData = this.stateData[stateCode];
      return {
        type: 'Feature',
        properties: {
          stateCode,
          ...stateData
        },
        geometry: {
          type: 'Point',
          coordinates: [stateData.lng, stateData.lat]
        }
      };
    });

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
          layer.bindTooltip(this.createTooltipContent(feature.properties), {
            permanent: false,
            direction: 'top',
            className: 'truck-tooltip',
            offset: [0, -10]
          });
        }
      }
    ).addTo(this.map);

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

  searchLocations({ country, city, keyword }) {
    // 미국 내 트럭 데이터만 있으므로 country는 'United States'로 고정
    this.filteredStatesData = Object.keys(this.allStatesData).reduce((filtered, stateCode) => {
      const stateData = this.allStatesData[stateCode];
      const stateName = stateData.name.toLowerCase();
      const searchTerm = keyword.toLowerCase();
      
      // 키워드 검색 (주 이름에 포함되는지 확인)
      if (keyword && !stateName.includes(searchTerm)) {
        return filtered;
      }
      
      filtered[stateCode] = stateData;
      return filtered;
    }, {});

    this.renderMap();
  }

  // 데이터 로드 시 allStatesData 저장
  loadData() {
    fetch('data/us-truck.json')
      .then(response => response.json())
      .then(data => {
        this.allStatesData = data;
        this.filteredStatesData = {...data};
        this.renderMap();
      })
      .catch(error => console.error('Error loading truck data:', error));
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
