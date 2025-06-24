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
    this.addControls(); // 새로 추가: 컨트롤 패널
  }

  // 기존 loadData 메서드 유지
  async loadData() {
    try {
      const response = await fetch('data/global-ports.json');
      this.currentData = await response.json();
      if (this.currentData.length > 0) {
        this.lastUpdated = this.currentData[0].date;
      }
      this.renderMarkers();
      this.addLastUpdatedText();
      this.addFilterControl();
    } catch (error) {
      console.error("Failed to load ocean data:", error);
    }
  }

  // 기존 addLastUpdatedText 메서드 유지
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

  // 수정된 renderMarkers 메서드 (호버 툴팁 기능 추가)
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

      // 기존: marker.bindPopup(this.createPopupContent(port));
      // 변경: 호버 이벤트로 툴팁 표시
      marker.on({
        mouseover: (e) => {
          const popup = L.popup()
            .setLatLng(e.latlng)
            .setContent(this.createPopupContent(port))
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

  addFilterControl() {
      const control = L.control({position: 'bottomright'});
      
      control.onAdd = () => {
          const div = L.DomUtil.create('div', 'filter-control');
          
          // 국가 목록 생성 (중복 제거)
          const countries = [...new Set(this.currentData.map(port => port.Country))];
          
          div.innerHTML = `
              <select class="country-filter">
                  <option value="">Select Country</option>
                  ${countries.map(country => 
                      `<option value="${country}">${country}</option>`
                  ).join('')}
              </select>
              <select class="port-filter" disabled>
                  <option value="">Select Port</option>
              </select>
          `;
          
          const countryFilter = div.querySelector('.country-filter');
          const portFilter = div.querySelector('.port-filter');
          
          countryFilter.addEventListener('change', (e) => {
              const country = e.target.value;
              portFilter.innerHTML = '<option value="">Select Port</option>';
              portFilter.disabled = !country;
              
              if (!country) {
                  this.map.setView([20, 0], 2);
                  return;
              }
              
              // 해당 국가의 포트 목록 필터링
              const countryPorts = this.currentData.filter(p => p.Country === country);
              
              // 포트 선택 옵션 추가
              countryPorts.forEach(port => {
                  const option = document.createElement('option');
                  option.value = port.Port;
                  option.textContent = port.Port;
                  portFilter.appendChild(option);
              });
              
              // 국가 중심으로 줌인
              const countryBounds = L.latLngBounds(
                  countryPorts.map(p => [p.Latitude, p.Longitude])
              );
              this.map.fitBounds(countryBounds.pad(0.3));
          });
          
          portFilter.addEventListener('change', (e) => {
              const portName = e.target.value;
              if (!portName) return;
              
              const port = this.currentData.find(p => p.Port === portName);
              if (port) {
                  this.map.setView([port.Latitude, port.Longitude], 8);
              }
          });
          
          return div;
      };
      
      control.addTo(this.map);
  }
  
  // 기존 유틸리티 메서드들 유지
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
