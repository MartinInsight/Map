class RailCongestionMap {
  constructor(mapId) {
    this.mapId = mapId;
    this.map = null;
    this.markers = [];
    this.allData = [];
    this.filteredData = [];
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
      const response = await fetch('../data/us-rail.json');
      const data = await response.json();
      this.allData = Array.isArray(data) ? data : data.data || [];
      this.filteredData = [...this.allData];
      this.renderMarkers();
    } catch (error) {
      console.error('Error loading rail data:', error);
      alert('레일 데이터 로드 실패: ' + error.message);
    }
  }

  renderMarkers(data = this.filteredData) {
    this.clearMarkers();
    
    this.markers = data.map(item => {
      const marker = L.circleMarker([item.Latitude, item.Longitude], {
        radius: this.getRadius(item.Average),
        fillColor: this.getColor(item.Category),
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      marker.bindTooltip(this.createTooltipContent(item), {
        permanent: false,
        direction: 'top',
        className: 'rail-tooltip'
      });

      marker.addTo(this.map);
      return marker;
    });

    this.adjustMapView();
  }

  getRadius(avgDwell) {
    return Math.min(15, Math.max(5, avgDwell / 2));
  }

  getColor(category) {
    const colors = {
      'Low': '#2ecc71',
      'Average': '#f39c12',
      'High': '#e74c3c'
    };
    return colors[category] || '#3498db';
  }

  createTooltipContent(data) {
    return `
      <div class="rail-tooltip">
        <h4>${data.Location || 'N/A'}</h4>
        <p><strong>Railroad:</strong> ${data.Railroad || 'N/A'}</p>
        <p><strong>Dwell Time:</strong> ${data['Dwell Time'] || 'N/A'} hrs</p>
        <p><strong>Avg:</strong> ${data.Average || 'N/A'} hrs</p>
        <p><strong>Status:</strong> <span style="color:${this.getColor(data.Category)}">
          ${data.Category || 'N/A'}
        </span></p>
      </div>
    `;
  }

  searchLocations({ keyword }) {
    const searchTerm = keyword?.toLowerCase() || '';
    this.filteredData = this.allData.filter(item =>
      item.Location.toLowerCase().includes(searchTerm) ||
      item.Railroad.toLowerCase().includes(searchTerm)
    );
    this.renderMarkers();
  }

  clearMarkers() {
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];
  }

  addResetButton() {
    const resetControl = L.control({ position: 'topright' });
    resetControl.onAdd = () => {
      const container = L.DomUtil.create('div', 'reset-control');
      const button = L.DomUtil.create('button', 'reset-btn', container);
      button.innerHTML = '<i class="fas fa-sync-alt"></i> Reset';
      button.onclick = () => {
        this.filteredData = [...this.allData];
        this.renderMarkers();
      };
      return container;
    };
    resetControl.addTo(this.map);
  }

  adjustMapView() {
    if (this.markers.length > 0) {
      this.map.fitBounds(L.featureGroup(this.markers).getBounds(), {
        padding: [50, 50],
        maxZoom: 8
      });
    } else {
      this.map.setView([37.8, -96], 4);
    }
  }
}
