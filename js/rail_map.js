class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);

        // L.markerClusterGroup 초기화 시 iconCreateFunction 옵션 사용
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40, // 필요에 따라 조정
            disableClusteringAtZoom: 9, // 필요에 따라 조정
            
            // 클러스터 아이콘 생성 함수 (가장 혼잡한 마커의 색상 반영)
            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevelValue = -1; // 혼잡도 값을 숫자로 변환하여 비교
                let dominantColor = this.getColor('Average'); // 기본값은 'Average' 색상

                // 혼잡도 레벨을 숫자로 매핑하는 함수 (가장 높은 혼잡도에 가장 큰 값)
                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Low': return 2;
                        case 'Very Low': return 1;
                        default: return 0; // 'Average', 'Unknown' 등
                    }
                };

                // 클러스터 내 모든 마커를 순회하며 가장 높은 혼잡도 레벨 찾기
                childMarkers.forEach(marker => {
                    const itemData = marker.options.itemData; // 마커 생성 시 저장했던 itemData 활용
                    if (itemData && itemData.congestion_level) {
                        const currentLevelValue = congestionLevelToValue(itemData.congestion_level);
                        if (currentLevelValue > highestCongestionLevelValue) {
                            highestCongestionLevelValue = currentLevelValue;
                            dominantColor = this.getColor(itemData.congestion_level); // 해당 혼잡도에 맞는 색상
                        }
                    }
                });

                // 클러스터 아이콘의 HTML 및 스타일 생성
                const childCount = cluster.getChildCount();
                // 클러스터 크기를 마커 개수에 따라 동적으로 조절 (최소 30px, 최대 60px)
                const size = 30 + Math.min(childCount * 0.5, 30); 
                
                return new L.DivIcon({
                    html: `<div style="background-color: ${dominantColor}; width: ${size}px; height: ${size}px; line-height: ${size}px; border-radius: 50%; color: white; font-weight: bold; text-align: center; display: flex; align-items: center; justify-content: center;"><span>${childCount}</span></div>`,
                    className: 'marker-cluster-custom', // CSS에서 추가 스타일링 가능
                    iconSize: new L.Point(size, size)
                });
            }
        });

        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null;
        this.errorControl = null;
        this.lastUpdatedControl = null;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        this.addRightControls(); // 오른쪽 컨트롤 추가 (필터, 리셋)
        this.addLastUpdatedText(); // 마지막 업데이트 텍스트 추가

        // 맵이 활성화될 때 데이터를 로드하고 마커를 렌더링
        // 이 부분은 HTML에서 초기 활성화된 맵에만 해당되므로 주석 처리
        // this.loadData();
    }

    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const rawData = await response.json();

            // Python 스크립트에서 이미 필요한 필드명으로 매핑되어 있으므로
            // 여기서는 추가적인 매핑 없이 데이터를 직접 사용합니다.
            this.currentData = rawData.filter(item =>
                // 필수 필드에 대한 유효성 검사 (Python에서 대부분 처리되지만 클라이언트 측에서 한 번 더 확인)
                item.lat && item.lng && !isNaN(item.lat) && !isNaN(item.lng) && item.location && item.congestion_level
            );

            if (this.currentData.length > 0) {
                // 파이썬 스크립트에서 date 필드가 string으로 들어오므로 그대로 사용
                this.lastUpdated = this.currentData[0].date; 
                this.updateLastUpdatedText(this.lastUpdated); // 텍스트 업데이트
            } else {
                this.updateLastUpdatedText('No data available');
            }

            this.renderMarkers();

        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
            this.updateLastUpdatedText('Error loading data');
        }
    }

    // 마커 렌더링
    renderMarkers(data = this.currentData) {
        if (!data) return; // 데이터가 없으면 리턴

        this.allMarkers.clearLayers(); // 기존 모든 마커 및 클러스터 제거

        data.forEach(item => {
            const marker = this.createSingleMarker(item);
            this.allMarkers.addLayer(marker); // 마커를 클러스터 그룹에 추가
        });

        // 맵에 클러스터 그룹이 추가되어 있지 않다면 추가
        if (!this.map.hasLayer(this.allMarkers)) {
            this.map.addLayer(this.allMarkers); 
        }
        
        // Leaflet.markercluster의 클러스터 클릭 이벤트를 커스텀하여 줌인만 하도록 설정
        this.allMarkers.on('clusterclick', (a) => {
            a.layer.zoomToBounds(); // 클러스터 클릭 시 해당 클러스터 범위로 줌인
            this.map.closePopup(); // 혹시 열려있을 호버 팝업 닫기
        });

        // Leaflet.markercluster의 클러스터 호버 이벤트를 사용하여 팝업 표시
        this.allMarkers.on('clustermouseover', (a) => {
            const clusterItems = a.layer.getAllChildMarkers().map(m => m.options.itemData);
            const popup = L.popup({
                closeButton: false,
                autoClose: true,
                closeOnClick: false,
                maxHeight: 300,
                maxWidth: 300
            })
            .setLatLng(a.latlng)
            .setContent(this.createPopupContent(clusterItems))
            .openOn(this.map);
        });

        this.allMarkers.on('clustermouseout', () => {
            this.map.closePopup();
        });
    }

    // 개별 마커 생성
    createSingleMarker(item) {
        const level = item.congestion_level || 'Average';
        const color = this.getColor(level);

        // 원형 마커 아이콘 생성
        const iconHtml = `
            <div style="background-color: ${color}; width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid white; box-shadow: 0 0 3px rgba(0,0,0,0.5);"></div>
        `;

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize: [15, 15],
            iconAnchor: [7.5, 7.5] // 아이콘의 중심을 마커 위치에 맞춤
        });

        // L.marker에 itemData를 options로 저장하여 나중에 팝업에서 사용
        const marker = L.marker([item.lat, item.lng], { icon: customIcon, itemData: item });

        // 개별 마커 클릭 시 팝업
        marker.on('click', () => {
            marker.bindPopup(this.createPopupContent(item)).openPopup(); // 단일 아이템 전달
        });

        return marker;
    }

    // 팝업 콘텐츠 생성 (단일 또는 다중 아이템 처리)
    createPopupContent(items) {
        // 단일 아이템을 위한 배열 변환
        const safeItems = Array.isArray(items) ? items : [items];
        const isMultiple = safeItems.length > 1;
        let content = '';

        if (isMultiple) {
            content += `<div class="cluster-popup-header">
                            <h4>${safeItems.length} Locations</h4>
                            <p>Showing clustered locations:</p>
                         </div>
                         <div class="cluster-popup-content">`;
        }

        safeItems.forEach(item => {
            // 파이썬 스크립트에서 이미 유효성 검사를 거치지만, 혹시 모를 경우를 대비한 최종 방어 로직
            if (!item || typeof item !== 'object' || !item.location || !item.congestion_level || typeof item.lat === 'undefined' || typeof item.lng === 'undefined') {
                console.warn("Skipping invalid or incomplete item for popup content:", item);
                return; // 유효하지 않은 아이템은 스킵
            }

            const level = item.congestion_level || 'Unknown';
            const company = item.company || 'Unknown';
            const location = item.location || 'Unknown Location';
            // congestion_score는 파이썬에서 float로 변환되었으므로 toFixed 사용 가능
            const congestionScore = item.congestion_score !== null && !isNaN(item.congestion_score) ? item.congestion_score.toFixed(1) : 'N/A';

            content += `
                <div class="location-info">
                    <h5>${location}</h5>
                    <p><strong>Company:</strong> ${company}</p>
                    <p><strong>Congestion Level:</strong>
                        <span style="color: ${this.getColor(level, true)}">
                            ${level}
                        </span>
                    </p>
                    <p><strong>Dwell Time:</strong> ${congestionScore} hours</p>
                </div>
                ${isMultiple && safeItems.indexOf(item) !== safeItems.length - 1 ? '<hr>' : ''}
            `;
        });

        if (isMultiple) {
            content += '</div>';
        }

        return content || '<p>No valid rail congestion data to display for this location.</p>';
    }

    // 혼잡도 레벨에 따른 색상 반환
    getColor(level, isText = false) {
        const circleColors = {
            'Very High': '#d62828', // 빨강
            'High': '#f88c2b',     // 주황
            'Low': '#5fa9f6',      // 밝은 파랑
            'Very Low': '#004fc0', // 진한 파랑
            'Average': '#bcbcbc',   // 회색 (기본값)
            'Unknown': '#bcbcbc'   // 알 수 없을 때도 회색
        };

        const textColors = {
            'Very High': '#d62828',
            'High': '#f88c2b',
            'Low': '#004fc0',
            'Very Low': '#004fc0',
            'Average': '#555555',
            'Unknown': '#555555'
        };

        return isText ? textColors[level] : circleColors[level];
    }

    // 오른쪽 컨트롤 (필터, 리셋) 추가
    addRightControls() {
        // 이미 추가된 컨트롤이 있으면 제거
        if (this.filterControlInstance && this.map.hasControl(this.filterControlInstance)) {
            this.map.removeControl(this.filterControlInstance);
        }

        // 필터 드롭다운 및 리셋 버튼을 포함하는 새로운 커스텀 컨트롤 정의
        const CongestionFilterControl = L.Control.extend({
            onAdd: function(map) {
                const container = L.DomUtil.create('div', 'map-control-group-right');
                L.DomEvent.disableClickPropagation(container); // 클릭 이벤트 전파 방지

                // 필터 드롭다운
                const selectBox = L.DomUtil.create('select', 'filter-control select', container);
                const options = ['All', 'Very High', 'High', 'Low', 'Very Low', 'Average'];
                options.forEach(optionText => {
                    const option = L.DomUtil.create('option', '', selectBox);
                    option.value = optionText;
                    option.textContent = optionText === 'All' ? 'Filter by Congestion' : optionText;
                    if (optionText === 'All') {
                        option.selected = true;
                        option.disabled = true;
                        option.hidden = true;
                    }
                });

                L.DomEvent.on(selectBox, 'change', (e) => {
                    const selectedLevel = e.target.value;
                    this._mapInstance.filterByCongestion(selectedLevel);
                }, this); // this 바인딩

                // 리셋 버튼
                const resetButton = L.DomUtil.create('button', 'reset-btn', container);
                resetButton.textContent = 'Reset View';
                L.DomEvent.on(resetButton, 'click', () => {
                    this._mapInstance.resetMap();
                }, this); // this 바인딩

                return container;
            },

            onRemove: function(map) {
                // Nothing to do here
            }
        });

        // 컨트롤 인스턴스 생성 및 지도에 추가
        this.filterControlInstance = new CongestionFilterControl({ position: 'topright' });
        this.filterControlInstance._mapInstance = this; // 맵 인스턴스를 컨트롤에 연결
        this.filterControlInstance.addTo(this.map);
    }

    // 마지막 업데이트 텍스트 컨트롤 추가
    addLastUpdatedText() {
        if (this.lastUpdatedControl && this.map.hasControl(this.lastUpdatedControl)) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        const LastUpdatedControl = L.Control.extend({
            onAdd: function(map) {
                this._div = L.DomUtil.create('div', 'last-updated-info');
                this.update(''); // 초기 텍스트 설정
                return this._div;
            },
            update: function(text) {
                this._div.innerHTML = `Last Updated: <strong>${text}</strong>`;
            }
        });

        this.lastUpdatedControl = new LastUpdatedControl({ position: 'bottomleft' });
        this.lastUpdatedControl.addTo(this.map);
        this.updateLastUpdatedText(this.lastUpdated || 'Loading...'); // 초기 텍스트 설정
    }

    updateLastUpdatedText(text) {
        if (this.lastUpdatedControl) {
            this.lastUpdatedControl.update(text);
        }
    }

    // 에러 메시지 표시
    displayErrorMessage(message) {
        if (this.errorControl && this.map.hasControl(this.errorControl)) {
            this.map.removeControl(this.errorControl);
        }

        const ErrorControl = L.Control.extend({
            onAdd: function(map) {
                const div = L.DomUtil.create('div', 'error-message');
                div.innerHTML = message;
                return div;
            },
            onRemove: function(map) {
                // Nothing to do here
            }
        });

        this.errorControl = new ErrorControl({ position: 'topleft' }); // 상단 좌측에 표시
        this.errorControl.addTo(this.map);

        // 5초 후 자동으로 메시지 제거
        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }

    // 맵 리셋
    resetMap() {
        this.map.setView([37.8, -96], 4); // 초기 뷰로 리셋
        if (this.filterControlInstance) {
            // 드롭다운을 'All'로 리셋 (첫 번째 옵션)
            this.filterControlInstance.getContainer().querySelector('select').value = 'All';
            this.filterControlInstance.getContainer().querySelector('select').selectedIndex = 0; // 'All' 옵션을 다시 선택되도록
        }
        this.renderMarkers(this.currentData); // 모든 마커 다시 렌더링
    }

    // 혼잡도 레벨에 따라 필터링
    filterByCongestion(level) {
        if (level === 'All' || !this.currentData) {
            this.renderMarkers(this.currentData);
        } else {
            const filtered = this.currentData.filter(item => item.congestion_level === level);
            this.renderMarkers(filtered);
        }
    }
}

// 전역 스코프에 클래스 노출 (HTML 스크립트에서 사용)
window.RailCongestionMap = RailCongestionMap;

// HTML의 DOMContentLoaded 이벤트에서 호출되므로 여기서 직접 loadData는 호출하지 않습니다.
// 대신 HTML의 메인 스크립트에서 map 인스턴스 생성 후 loadData()를 호출하도록 합니다.
