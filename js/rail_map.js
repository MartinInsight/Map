// js/rail_map.js
// 기존 코드에 추가할 내용
class RailCongestionMap {
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
      this.map.setView([37.8, -96], 4);
    };
    
    this.map.getContainer().appendChild(resetBtn);
  }

  addSearchControl() {
    const searchContainer = L.DomUtil.create('div', 'search-container');
    
    const countrySelect = L.DomUtil.create('select', '', searchContainer);
    countrySelect.innerHTML = '<option value="">Select Country</option>';
    
    const citySelect = L.DomUtil.create('select', '', searchContainer);
    citySelect.innerHTML = '<option value="">Select City</option>';
    
    const keywordInput = L.DomUtil.create('input', '', searchContainer);
    keywordInput.placeholder = 'Enter keyword';
    
    const searchBtn = L.DomUtil.create('button', '', searchContainer);
    searchBtn.textContent = 'Search';
    
    // 국가 및 도시 데이터 채우기
    this.populateSearchOptions(countrySelect, citySelect);
    
    searchBtn.onclick = () => {
      this.filterMarkers(
        countrySelect.value,
        citySelect.value,
        keywordInput.value
      );
    };
    
    this.map.getContainer().appendChild(searchContainer);
  }

  populateSearchOptions(countrySelect, citySelect) {
    const countries = new Set();
    const citiesByCountry = {};
    
    this.currentData.forEach(item => {
      if (item.country) countries.add(item.country);
      if (item.city && item.country) {
        if (!citiesByCountry[item.country]) {
          citiesByCountry[item.country] = new Set();
        }
        citiesByCountry[item.country].add(item.city);
      }
    });
    
    // 국가 옵션 채우기
    countries.forEach(country => {
      const option = L.DomUtil.create('option', '', countrySelect);
      option.value = country;
      option.textContent = country;
    });
    
    // 국가 선택 시 도시 옵션 업데이트
    countrySelect.onchange = () => {
      citySelect.innerHTML = '<option value="">Select City</option>';
      
      if (countrySelect.value && citiesByCountry[countrySelect.value]) {
        citiesByCountry[countrySelect.value].forEach(city => {
          const option = L.DomUtil.create('option', '', citySelect);
          option.value = city;
          option.textContent = city;
        });
      }
    };
  }

  filterMarkers(country, city, keyword) {
    const lowerKeyword = keyword.toLowerCase();
    
    this.markers.forEach(marker => {
      const data = marker.options.data;
      const matchesCountry = !country || data.country === country;
      const matchesCity = !city || data.city === city;
      const matchesKeyword = !keyword || 
        (data.location && data.location.toLowerCase().includes(lowerKeyword)) ||
        (data.company && data.company.toLowerCase().includes(lowerKeyword));
      
      if (matchesCountry && matchesCity && matchesKeyword) {
        marker.setStyle({ opacity: 1, fillOpacity: 0.8 });
      } else {
        marker.setStyle({ opacity: 0.3, fillOpacity: 0.2 });
      }
    });
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
        fillOpacity: 0.8,
        data: item // 데이터를 마커에 저장
      });

      // 호버 이벤트 추가
      marker.on('mouseover', () => {
        if (this.currentPopup) {
          this.map.closePopup(this.currentPopup);
        }
        this.currentPopup = L.popup()
          .setLatLng([item.lat, item.lng])
          .setContent(this.createPopupContent(item))
          .openOn(this.map);
      });

      marker.on('mouseout', () => {
        if (this.currentPopup) {
          this.map.closePopup(this.currentPopup);
          this.currentPopup = null;
        }
      });

      marker.bindPopup(this.createPopupContent(item));
      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }
}

  getRadiusByIndicator(indicator) {
    // Indicator 값에 따른 원 크기 (명확한 5단계 구분)
    if (indicator > 2) return 20;    // 제일 큼
    if (indicator > 1) return 16;    // 중간 큼
    if (indicator > -1) return 12;   // 중간
    if (indicator > -2) return 8;    // 중간 작음
    return 5;                        // 제일 작음
  }

  getColor(level, isText = false) {
    // 원 색상 (기존보다 약간 연하게)
    const circleColors = {
      'Very High': '#d62828',   // 원: 빨강
      'High': '#f88c2b',        // 원: 주황
      'Average': '#bcbcbc',     // 원: 회색
      'Low': '#5fa9f6',         // 원: 하늘
      'Very Low': '#004fc0'     // 원: 파랑
    };
    
    // 텍스트 색상 (원보다 더 진하게)
    const textColors = {
      'Very High': '#6b1414',   // 텍스트: 빨강
      'High': '#7c4616',        // 텍스트: 주황
      'Average': '#5e5e5e',     // 텍스트: 회색
      'Low': '#30557b',         // 텍스트: 하늘
      'Very Low': '#002860'     // 텍스트: 파랑
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
          <span style="color: ${this.getColor(level, true)}"> <!-- 텍스트용 진한 색상 -->
            ${level}
          </span>
        </p>
        <p><strong>Dwell Time:</strong> ${data.congestion_score?.toFixed(1) || 'N/A'} hours</p>
      </div>
    `;
  }
}

window.RailCongestionMap = RailCongestionMap;
