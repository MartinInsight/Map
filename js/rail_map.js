// js/rail_map.js
class RailCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.markers = [];
    this.currentData = null;
    this.lastUpdated = null;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    this.loadData();
    this.addControls(); // 컨트롤 패널 추가 (리셋 버튼)
  }

  async loadData() {
    try {
      const response = await fetch('data/us-rail.json');
      this.currentData = await response.json();
      if (this.currentData.length > 0) {
        this.lastUpdated = this.currentData[0].date;
      }
      this.renderMarkers();
      this.addLastUpdatedText();
      this.addFilterControl();
    } catch (error) {
      console.error("Failed to load rail data:", error);
    }
  }

  addLastUpdatedText() {
    if (this.lastUpdated) {
      const date = new Date(this.lastUpdated);
      const formattedDate = `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;

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

    this.currentData.forEach(item => {
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: this.getRadiusByIndicator(item.indicator),
        fillColor: this.getColor(item.congestion_level),
        color: "#000",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      marker.on({
        mouseover: (e) => {
          const popup = L.popup()
            .setLatLng(e.latlng)
            .setContent(this.createPopupContent(item))
            .openOn(this.map);
        },
        mouseout: () => {
          this.map.closePopup();
        },
        click: () => {
          this.map.closePopup();
        }
      });

      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }

  addControls() {
    const controlContainer = L.control({ position: 'topright' });

    controlContainer.onAdd = () => {
      const div = L.DomUtil.create('div', 'rail-control-container');
      div.innerHTML = `
        <button class="rail-reset-btn">Reset View</button>
      `;

      div.querySelector('.rail-reset-btn').addEventListener('click', () => {
        this.map.setView([37.8, -96], 4);
      });

      return div;
    };

    controlContainer.addTo(this.map);
  }

  addFilterControl() {
      const control = L.control({ position: 'bottomright' });
  
      control.onAdd = () => {
          const div = L.DomUtil.create('div', 'filter-control');
  
          // 야드 목록 생성 (중복 제거 및 알파벳 순 정렬)
          const yards = [...new Set(this.currentData
              .filter(item => item.Yard) // undefined 제거
              .map(item => item.Yard)
          )].sort((a, b) => a.localeCompare(b));
  
          div.innerHTML = `
              <select class="yard-filter">
                  <option value="">Select Yard</option>
                  ${yards.map(yard => 
                      `<option value="${yard}">${yard}</option>`
                  ).join('')}
              </select>
          `;
  
          div.querySelector('.yard-filter').addEventListener('change', (e) => {
              const yardName = e.target.value;
              if (!yardName) {
                  this.map.setView([37.8, -96], 4);
                  this.renderMarkers();
                  return;
              }
  
              const yard = this.currentData.find(item => item.Yard === yardName);
              if (yard) {
                  this.map.setView([yard.Latitude, yard.Longitude], 8);
                  this.renderMarkers(this.currentData.filter(item => 
                      item.Yard === yardName
                  ));
              }
          });
  
          return div;
      };
  
      control.addTo(this.map);
  }

  getRadiusByIndicator(indicator) {
    if (indicator > 2) return 20;
    if (indicator > 1) return 16;
    if (indicator > -1) return 12;
    if (indicator > -2) return 8;
    return 5;
  }

  getColor(level, isText = false) {
    const circleColors = {
      'Very High': '#d62828',
      'High': '#f88c2b',
      'Average': '#bcbcbc',
      'Low': '#5fa9f6',
      'Very Low': '#004fc0'
    };

    const textColors = {
      'Very High': '#6b1414',
      'High': '#7c4616',
      'Average': '#5e5e5e',
      'Low': '#30557b',
      'Very Low': '#002860'
    };

    return isText ? textColors[level] : circleColors[level];
  }

  createPopupContent(data) {
    const level = data.congestion_level || 'Unknown';

    return `
      <div class="rail-tooltip">
        <h4>${data.location || 'Unknown Location'}</h4>
        <p><strong>Company:</strong> ${data.company || 'Unknown'}</p>
        <p><strong>Congestion Level:</strong> 
          <span style="color: ${this.getColor(level, true)}">
            ${level}
          </span>
        </p>
        <p><strong>Dwell Time:</strong> ${data.congestion_score?.toFixed(1) || 'N/A'} hours</p>
      </div>
    `;
  }
}

window.RailCongestionMap = RailCongestionMap;
