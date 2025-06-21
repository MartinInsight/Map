// js/ocean_map.js
class OceanCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([20, 0], 2);
    this.markers = [];
    this.currentData = null;
    this.lastUpdated = null;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    this.loadData();
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
      
      // 호버 및 클릭 이벤트 추가
      marker.on({
        mouseover: function() {
          this.setStyle({ weight: 3, fillOpacity: 1 });
        },
        mouseout: function() {
          this.setStyle({ weight: 1, fillOpacity: 0.8 });
        },
        click: () => this.zoomToMarker(port.lat, port.lng)
      });
      
      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }
  
  // 줌 기능 추가
  zoomToMarker(lat, lng) {
    this.map.setView([lat, lng], 8, {
      animate: true,
      duration: 1
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
