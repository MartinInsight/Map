class OceanCongestionMap {
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
      preferCanvas: true,
      worldCopyJump: true
    }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
      noWrap: true
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);
  }

  async loadData() {
    try {
      const response = await fetch('../data/global-ports.json');
      const data = await response.json();
      this.allData = Array.isArray(data) ? data : data.data || [];
      this.filteredData = [...this.allData];
      this.renderMarkers();
    } catch (error) {
      console.error('Error loading ocean data:', error);
      alert('항구 데이터 로드 실패: ' + error.message);
    }
  }

  renderMarkers(data = this.filteredData) {
    this.clearMarkers();

    this.markers = data.map(item => {
      const marker = L.circleMarker([item.Latitude, item.Longitude], {
        radius: this.getRadius(item['Current Delay (days)']),
        fillColor: this.getColor(item['Delay Level']),
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      marker.bindTooltip(this.createTooltipContent(item), {
        permanent: false,
        direction: 'top',
        className: 'ocean-tooltip'
      });

      marker.addTo(this.map);
      return marker;
    });

    this.adjustMapView();
  }

  getRadius(delayDays) {
    return Math.min(20, Math.max(5, delayDays * 1.5));
  }

  getColor(level) {
    const colors = {
      'low': '#2ecc71',
      'medium': '#f39c12',
      'high': '#e74c3c',
      'extreme': '#8e44ad'
    };
    return colors[level?.toLowerCase()] || '#3498db';
  }

  createTooltipContent(data) {
    return `
      <div class="ocean-tooltip">
        <h4>${data.Port || 'N/A'}, ${data.Country || 'N/A'}</h4>
        <p><strong>Current Delay:</strong> ${data['Current Delay (days)'] || '0'} days</p>
        <p><strong>Weekly Max:</strong> ${data['Weekly Max Delay'] || 'N/A'} days</p>
        <p><strong>Monthly Max:</strong> ${data['Monthly Max Delay'] || 'N/A'} days</p>
        <p><strong>Status:</strong> <span style="color:${this.getColor(data['Delay Level'])}">
          ${data['Delay Level'] || 'N/A'}
        </span></p>
      </div>
    `;
  }

  searchLocations({ country, keyword }) {
    const countryTerm = country?.toLowerCase() || '';
    const keywordTerm = keyword?.toLowerCase() || '';
    
    this.filteredData = this.allData.filter(item =>
      (item.Country.toLowerCase().includes(countryTerm) ||
       item['Country Code'].toLowerCase().includes(countryTerm)) &&
      (item.Port.toLowerCase().includes(keywordTerm) ||
       item['Port Code'].toLowerCase().includes(keywordTerm))
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
        maxZoom: 5
      });
    } else {
      this.map.setView([20, 0], 2);
    }
  }
}
