class OceanCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([20, 0], 2);
    this.markers = [];
    this.currentData = null;
    this.lastUpdated = null;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    // 리셋 버튼 추가 (트럭맵과 동일한 스타일)
    this.addResetButton();
    this.loadData();
  }

  addResetButton() {
    const container = L.DomUtil.create('div', 'map-control-container');
    container.innerHTML = `
      <button class="reset-view-btn">Reset View</button>
    `;
    
    container.querySelector('.reset-view-btn').addEventListener('click', () => {
      this.map.setView([20, 0], 2);
    });

    this.map.getContainer().appendChild(container);
  }

  async loadData() {
    try {
      const response = await fetch('data/global-ports.json');
      this.currentData = await response.json();
      if (this.currentData.length > 0) {
        this.lastUpdated = this.currentData[0].date;
      }
      this.renderMarkers();
      this.addLastUpdatedText();
    } catch (error) {
      console.error("Failed to load ocean data:", error);
    }
  }

  addLastUpdatedText() {
    if (this.lastUpdated) {
      const date = new Date(this.lastUpdated);
      const formattedDate = `${date.getMonth()+1}-${date.getDate()}-${date.getFullYear()}`;
      
      const infoControl = L.control({ position: 'bottomleft' });
      
      infoControl.onAdd = () => {
        const div = L.DomUtil.create('div', 'last-updated-info');
        div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
        div.style.backgroundColor = 'white';
        div.style.padding = '5px 10px';
        div.style.borderRadius = '5px';
        div.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
        return div;
      };
      
      infoControl.addTo(this.map);
    }
  }

  renderMarkers() {
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];

    this.currentData.forEach(port => {
      const marker = L.circleMarker([port.lat, port.lng], {
        radius: this.getRadiusByDelay(port.current_delay_days),
        fillColor: this.getColor(port.delay_level),
        color: "#000",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      marker.bindPopup(this.createPopupContent(port));
      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }

  getRadiusByDelay(delayDays) {
    if (!delayDays) return 5;
    return Math.min(20, Math.max(5, delayDays * 1.5));
  }

  getColor(level) {
    const colors = {
      'low': '#4CAF50',    // Green
      'medium': '#FFC107', // Amber
      'high': '#F44336'    // Red
    };
    return colors[level] || '#555';
  }

  addControls() {
    const controlContainer = L.control({ position: 'topright' });
    
    controlContainer.onAdd = () => {
      this.controlDiv = L.DomUtil.create('div', 'ocean-control-container');
      this.renderControls();
      return this.controlDiv;
    };
    
    controlContainer.addTo(this.map);
  }

  renderControls() {
    this.controlDiv.innerHTML = `
      <button class="ocean-reset-btn" id="ocean-reset-view">Reset View</button>
    `;

    this.controlDiv.querySelector('#ocean-reset-view').addEventListener('click', () => {
      this.map.setView([20, 0], 2);
    });
  }  
  
  createPopupContent(port) {
    return `
      <div class="ocean-tooltip">
        <h4>${port.port}, ${port.country}</h4>
        <p><strong>Current Delay:</strong> ${port.current_delay}</p>
        <p><strong>Delay Level:</strong> 
          <span style="color: ${this.getTextColor(port.delay_level)}">
            ${port.delay_level}
          </span>
        </p>
        <p><strong>Port Code:</strong> ${port.port_code}</p>
        <p><strong>Weekly Median:</strong> ${port.weekly_median_delay} days</p>
        <p><strong>Monthly Max:</strong> ${port.monthly_max_delay} days</p>
      </div>
    `;
  }
  
  getTextColor(level) {
    const colors = {
      'low': '#2E7D32',    // Dark Green
      'medium': '#FF8F00', // Dark Amber
      'high': '#C62828'    // Dark Red
    };
    return colors[level] || '#333';
  }
}

window.OceanCongestionMap = OceanCongestionMap;
