class TruckCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.stateData = {};
    this.filteredData = {};
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
      const [statesRes, truckRes] = await Promise.all([
        fetch('../data/us-states.json'),
        fetch('../data/us-truck.json')
      ]);
      
      const [statesGeoJSON, truckData] = await Promise.all([
        statesRes.json(),
        truckRes.json()
      ]);

      this.stateData = statesGeoJSON.features.reduce((acc, feature) => {
        const stateCode = feature.id;
        const stateTruckData = truckData.find(item => item.Code === stateCode);
        if (stateTruckData) {
          const center = this.calculateCentroid(feature.geometry);
          acc[stateCode] = {
            ...stateTruckData,
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
      alert('트럭 데이터 로드 실패: ' + error.message);
    }
  }

  calculateCentroid(geometry) {
    if (geometry.type === 'Polygon') {
      const coords = geometry.coordinates[0];
      let x = 0, y = 0;
      coords.forEach(coord => {
        x += coord[0];
        y += coord[1];
      });
      return {
        lng: x / coords.length,
        lat: y / coords.length
      };
    }
    return { lng: -98.5795, lat: 39.8283 };
  }

  renderMap(data = this.filteredData) {
    if (this.geojson) this.map.removeLayer(this.geojson);

    this.geojson = L.geoJSON({
      type: 'FeatureCollection',
      features: Object.entries(data).map(([stateCode, stateData]) => ({
        type: 'Feature',
        properties: stateData,
        geometry: {
          type: 'Point',
          coordinates: [stateData.lng, stateData.lat]
        }
      }))
    }, {
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: 10,
          fillColor: this.getColor(feature.properties['Inbound Color']),
          color: '#fff',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        });
      },
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(this.createTooltipContent(feature.properties));
      }
    }).addTo(this.map);

    this.map.fitBounds(this.geojson.getBounds());
  }

  getColor(value) {
    const colors = {
      '-2': '#e74c3c', // Red
      '-1': '#f39c12', // Orange
      '1': '#2ecc71',  // Green
      '2': '#3498db'   // Blue
    };
    return colors[value?.toString()] || '#95a5a6';
  }

  createTooltipContent(data) {
    return `
      <div class="truck-tooltip">
        <h4>${data.name || 'N/A'}</h4>
        <p><strong>Inbound Delay:</strong> ${data['Inbound Delay'] || 'N/A'} days</p>
        <p><strong>Outbound Delay:</strong> ${data['Outbound Delay'] || 'N/A'} days</p>
        <p><strong>Dwell Inbound:</strong> ${data['Dwell Inbound'] || 'N/A'} days</p>
        <p><strong>Dwell Outbound:</strong> ${data['Dwell Outbound'] || 'N/A'} days</p>
      </div>
    `;
  }

  searchLocations({ location, keyword }) {
    const searchTerm = keyword?.toLowerCase() || '';
    this.filteredData = Object.fromEntries(
      Object.entries(this.stateData).filter(([_, state]) => 
        state.name.toLowerCase().includes(searchTerm) ||
        state.Code.toLowerCase().includes(searchTerm)
    );
    this.renderMap();
  }

  addResetButton() {
    const resetControl = L.control({ position: 'topright' });
    resetControl.onAdd = () => {
      const container = L.DomUtil.create('div', 'reset-control');
      const button = L.DomUtil.create('button', 'reset-btn', container);
      button.innerHTML = '<i class="fas fa-sync-alt"></i> Reset';
      button.onclick = () => {
        this.filteredData = {...this.stateData};
        this.renderMap();
      };
      return container;
    };
    resetControl.addTo(this.map);
  }
}
