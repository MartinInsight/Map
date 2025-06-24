class OceanCongestionMap {
  constructor(mapElementId) {
    // 기존 생성자 코드 유지
    
    // 리셋 버튼 추가
    this.addResetButton();
    // 검색 기능 추가
    this.addSearchControl();
    
    // 호버 이벤트를 위해 마커에 이벤트 리스너 추가
    this.map.on('popupclose', () => {
      this.currentPopup = null;
    });
  }

  addResetButton() {
    const resetBtn = L.DomUtil.create('button', 'reset-view-btn');
    resetBtn.textContent = 'Reset View';
    resetBtn.onclick = () => {
      this.map.setView([20, 0], 2);
    };
    
    this.map.getContainer().appendChild(resetBtn);
  }

  addSearchControl() {
    const searchContainer = L.DomUtil.create('div', 'search-container');
    
    const countrySelect = L.DomUtil.create('select', '', searchContainer);
    countrySelect.innerHTML = '<option value="">Select Country</option>';
    
    const portSelect = L.DomUtil.create('select', '', searchContainer);
    portSelect.innerHTML = '<option value="">Select Port</option>';
    
    const keywordInput = L.DomUtil.create('input', '', searchContainer);
    keywordInput.placeholder = 'Enter keyword';
    
    const searchBtn = L.DomUtil.create('button', '', searchContainer);
    searchBtn.textContent = 'Search';
    
    // 국가 및 포트 데이터 채우기
    this.populateSearchOptions(countrySelect, portSelect);
    
    searchBtn.onclick = () => {
      this.filterMarkers(
        countrySelect.value,
        portSelect.value,
        keywordInput.value
      );
    };
    
    this.map.getContainer().appendChild(searchContainer);
  }

  populateSearchOptions(countrySelect, portSelect) {
    const countries = new Set();
    const portsByCountry = {};
    
    this.currentData.forEach(port => {
      if (port.country) countries.add(port.country);
      if (port.port && port.country) {
        if (!portsByCountry[port.country]) {
          portsByCountry[port.country] = new Set();
        }
        portsByCountry[port.country].add(port.port);
      }
    });
    
    // 국가 옵션 채우기
    countries.forEach(country => {
      const option = L.DomUtil.create('option', '', countrySelect);
      option.value = country;
      option.textContent = country;
    });
    
    // 국가 선택 시 포트 옵션 업데이트
    countrySelect.onchange = () => {
      portSelect.innerHTML = '<option value="">Select Port</option>';
      
      if (countrySelect.value && portsByCountry[countrySelect.value]) {
        portsByCountry[countrySelect.value].forEach(port => {
          const option = L.DomUtil.create('option', '', portSelect);
          option.value = port;
          option.textContent = port;
        });
      }
    };
  }

  filterMarkers(country, port, keyword) {
    const lowerKeyword = keyword.toLowerCase();
    
    this.markers.forEach(marker => {
      const data = marker.options.data;
      const matchesCountry = !country || data.country === country;
      const matchesPort = !port || data.port === port;
      const matchesKeyword = !keyword || 
        (data.port && data.port.toLowerCase().includes(lowerKeyword)) ||
        (data.port_code && data.port_code.toLowerCase().includes(lowerKeyword));
      
      if (matchesCountry && matchesPort && matchesKeyword) {
        marker.setStyle({ opacity: 1, fillOpacity: 0.8 });
      } else {
        marker.setStyle({ opacity: 0.3, fillOpacity: 0.2 });
      }
    });
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
        fillOpacity: 0.8,
        data: port // 데이터를 마커에 저장
      });

      // 호버 이벤트 추가
      marker.on('mouseover', () => {
        if (this.currentPopup) {
          this.map.closePopup(this.currentPopup);
        }
        this.currentPopup = L.popup()
          .setLatLng([port.lat, port.lng])
          .setContent(this.createPopupContent(port))
          .openOn(this.map);
      });

      marker.on('mouseout', () => {
        if (this.currentPopup) {
          this.map.closePopup(this.currentPopup);
          this.currentPopup = null;
        }
      });

      marker.bindPopup(this.createPopupContent(port));
      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }
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
