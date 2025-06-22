class TruckCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.stateData = {}; // 모든 주 데이터 저장
    this.filteredData = {}; // 필터링된 주 데이터 저장
    this.geojson = null;
    this.initMap();
    this.loadData();
    this.addResetButton();
  }

  initMap() {
    this.map = L.map(this.mapId, {
      zoomControl: false,
      preferCanvas: true
    }).setView([37.8, -96], 4);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);
  }

  async loadData() {
    try {
      // 주 GeoJSON 데이터 로드
      const statesRes = await fetch('data/us-states.json');
      const statesGeoJSON = await statesRes.json();
      
      // 트럭 데이터 로드
      const truckRes = await fetch('data/us-truck.json');
      const truckData = await truckRes.json();
      
      // 데이터 병합 및 중심점 계산
      this.stateData = statesGeoJSON.features.reduce((acc, feature) => {
        const stateCode = feature.id;
        if (truckData[stateCode]) {
          // 정확한 중심점 계산 (모든 폴리곤 고려)
          const center = this.calculateCentroid(feature.geometry);
          
          acc[stateCode] = {
            ...truckData[stateCode],
            lat: center.lat,
            lng: center.lng,
            name: feature.properties.name
          };
        }
        return acc;
      }, {});

      this.filteredData = {...this.stateData};
      this.renderMap();
    } catch (error) {
      console.error('Error loading truck data:', error);
    }
  }

  // 폴리곤의 중심점 계산 (더 정확한 버전)
  calculateCentroid(geometry) {
    if (geometry.type === 'Polygon') {
      let totalArea = 0;
      let centroidX = 0;
      let centroidY = 0;
      const coords = geometry.coordinates[0]; // 외곽선만 고려

      for (let i = 0; i < coords.length - 1; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[i + 1];
        const a = x1 * y2 - x2 * y1;
        totalArea += a;
        centroidX += (x1 + x2) * a;
        centroidY += (y1 + y2) * a;
      }

      totalArea /= 2;
      centroidX /= 6 * totalArea;
      centroidY /= 6 * totalArea;

      return { lng: centroidX, lat: centroidY };
    }
    // MultiPolygon인 경우 첫 번째 폴리곤 사용
    else if (geometry.type === 'MultiPolygon') {
      return this.calculateCentroid({
        type: 'Polygon',
        coordinates: geometry.coordinates[0]
      });
    }
    return { lng: -98.5795, lat: 39.8283 }; // 기본값 (미국 중심)
  }

  renderMap(data = this.filteredData) {
    if (this.geojson) {
      this.map.removeLayer(this.geojson);
    }

    const geojsonFeatures = Object.keys(data).map(stateCode => {
      const stateData = data[stateCode];
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

  getColor(value) {
    const hue = value > 0 ? 
      120 * (value / 3) : // 초록색 범위
      60 * (1 + value / 3); // 노랑-빨강 범위
    return `hsl(${hue}, 100%, 50%)`;
  }

  searchLocations({ location, keyword }) {
    this.filteredData = Object.keys(this.stateData).reduce((filtered, stateCode) => {
      const stateData = this.stateData[stateCode];
      
      // 위치 필터링 (주 코드 또는 주 이름)
      if (location && stateCode !== location && 
          !stateData.name.toLowerCase().includes(location.toLowerCase())) {
        return filtered;
      }
      
      // 키워드 검색 (주 이름)
      if (keyword && 
          !stateData.name.toLowerCase().includes(keyword.toLowerCase())) {
        return filtered;
      }
      
      filtered[stateCode] = stateData;
      return filtered;
    }, {});

    this.renderMap();
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
}
