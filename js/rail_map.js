/**
 * RailCongestionMap 클래스는 철도 혼잡도 데이터를 지도에 시각화하고 상호작용 기능을 제공합니다.
 * Leaflet.js와 Leaflet.markercluster 플러그인을 활용합니다.
 */
class RailCongestionMap {
    /**
     * RailCongestionMap의 생성자입니다.
     * @param {string} mapElementId - 지도를 렌더링할 HTML 요소의 ID입니다.
     */
    constructor(mapElementId) {
        // Leaflet 지도 초기화: 기본 시점과 줌 레벨 설정 (미국 중심)
        this.map = L.map(mapElementId).setView([37.8, -96], 4);

        // 마커 클러스터 그룹 초기화
        // - maxClusterRadius: 클러스터링될 최대 픽셀 거리 (40px로 축소하여 더 빠르게 분리되도록)
        // - disableClusteringAtZoom: 이 줌 레벨부터 클러스터링 비활성화 (개별 마커 표시)
        // - spiderfyOnMaxZoom: 최대 줌에서 스파이더파이 (겹치는 마커 분산)
        // - spiderfyDistanceMultiplier: 스파이더파이 시 마커 간 거리 조절
        // - iconCreateFunction: 클러스터 아이콘을 커스터마이즈하는 함수
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40,
            disableClusteringAtZoom: 9,
            spiderfyOnMaxZoom: true,
            spiderfyDistanceMultiplier: 2,
            showCoverageOnHover: false,
            showCoverageOnClick: false,

            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevelValue = -1;
                let dominantColor = this.getColor('Average'); // 기본값: 평균 색상

                // 혼잡도 레벨을 숫자로 매핑하여 비교 가능하게 함
                // 이 함수는 RailCongestionMap 클래스의 멤버 함수로 옮기는 것이 더 좋지만,
                // 현재 기능 수정 금지 요청으로 인해 임시로 여기에 유지합니다.
                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Average': return 2; // Average 추가
                        case 'Low': return 1;
                        case 'Very Low': return 0;
                        default: return -1; // Fallback for unknown levels
                    }
                };
                
                // 클러스터 내의 마커 중 가장 높은 혼잡도 레벨의 색상 선택
                childMarkers.forEach(marker => {
                    const itemData = marker.options.itemData;
                    if (itemData && itemData.congestion_level) {
                        const currentLevelValue = congestionLevelToValue(itemData.congestion_level);
                        if (currentLevelValue > highestCongestionLevelValue) {
                            highestCongestionLevelValue = currentLevelValue;
                            dominantColor = this.getColor(itemData.congestion_level);
                        }
                    }
                });

                const childCount = cluster.getChildCount();
                // 클러스터 크기를 자식 마커 수에 따라 동적으로 조절
                const size = 30 + Math.min(childCount * 0.5, 30);

                // 커스텀 클러스터 아이콘 생성 (원형, 배경색은 가장 높은 혼잡도에 따라)
                return new L.DivIcon({
                    html: `<div style="background-color: ${dominantColor}; width: ${size}px; height: ${size}px; line-height: ${size}px; border-radius: 50%; color: white; font-weight: bold; text-align: center; display: flex; align-items: center; justify-content: center;"><span>${childCount}</span></div>`,
                    className: 'marker-cluster-custom', // CSS 스타일링을 위한 클래스
                    iconSize: new L.Point(size, size)
                });
            }
        });

        this.currentData = null; // 현재 로드된 데이터
        this.lastUpdated = null; // 마지막 업데이트 날짜
        this.filterControlInstance = null; // 필터 컨트롤 인스턴스
        this.errorControl = null; // 에러 메시지 컨트롤
        this.lastUpdatedControl = null; // 마지막 업데이트 정보 컨트롤
        this.markerToOpenAfterMove = null; // 지도 이동 후 팝업을 열 마커 이름
        this.lastOpenedMarker = null; // 마지막으로 열린 팝업의 마커 참조

        // 지도 타일 레이어 추가 (CARTO Light All)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        // 지도 경계 설정 (전 세계 범위)
        this.map.setMaxBounds([
            [-85, -180], // 남서쪽 경계
            [85, 180]    // 북동쪽 경계
        ]);

        // 데이터 로드 시작
        this.loadData();

        // 팝업 열림 이벤트 핸들러
        this.map.on('popupopen', (e) => {
            if (e.popup && e.popup._source && e.popup._source instanceof L.Marker) {
                this.lastOpenedMarker = e.popup._source;
                console.log(`Popup for ${this.lastOpenedMarker.options.itemData.Yard} opened.`);
            }
        });

        // 팝업 닫힘 이벤트 핸들러
        this.map.on('popupclose', (e) => {
            console.log(`Popup for ${e.popup._source ? e.popup._source.options.itemData.Yard : 'unknown'} closed.`);
            if (this.lastOpenedMarker === e.popup._source) {
                this.lastOpenedMarker = null; // 닫힌 팝업의 마커를 lastOpenedMarker에서 제거
            }
        });

        // 맵 클릭 이벤트 핸들러 조정
        this.map.on('click', (e) => {
            // 마커 팝업이 열려있거나 열릴 예정인 경우 맵 클릭은 무시
            if (this.lastOpenedMarker && this.lastOpenedMarker.getPopup().isOpen()) {
                console.log('Map click: A marker popup is already open. Ignoring.');
                //return; // 이전에 열린 팝업이 있다면 무시 (이번에는 팝업 자동 닫힘 기능 활성화로 인해 이 조건이 필요 없을 수 있음)
            }
            if (this.markerToOpenAfterMove) { // 이동 후 팝업을 열기 위해 대기중인 경우
                console.log('Map click: Waiting to open a marker popup. Ignoring.');
                return;
            }
            // 맵 배경 클릭 시 기존 팝업 닫기
            console.log('Map background clicked. Closing any open popups.');
            this.map.closePopup();
            this.lastOpenedMarker = null;
        });

        // 지도 이동 종료 이벤트 핸들러
        this.map.on('moveend', () => {
            if (this.markerToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup with polling.');
                const yardName = this.markerToOpenAfterMove;
                this.markerToOpenAfterMove = null; // 초기화
                this.pollForMarkerAndOpenPopup(yardName);
            }
        });
    }

    /**
     * 특정 야드 이름에 해당하는 마커를 찾고, 폴링을 통해 마커가 준비되면 팝업을 엽니다.
     * @param {string} yardName - 팝업을 열 야드의 이름입니다.
     */
    pollForMarkerAndOpenPopup(yardName) {
        let targetMarker = null;
        // 클러스터 그룹 내에서 마커를 찾습니다.
        this.allMarkers.eachLayer(layer => {
            if (layer.options.itemData && layer.options.itemData.Yard === yardName) {
                targetMarker = layer;
                return; // Leaflet eachLayer의 return은 break 역할
            }
        });

        if (!targetMarker) {
            console.warn(`pollForMarkerAndOpenPopup: Marker for yard '${yardName}' not found in current layers (might be in a cluster).`);
            return;
        }

        // 팝업이 이미 마커에 바인딩되어 있는지 확인
        if (!targetMarker.getPopup()) {
            console.warn("pollForMarkerAndOpenPopup: Invalid marker or no popup associated.");
            return;
        }

        // 기존 팝업 닫기 (새로운 팝업을 열기 전에 항상 닫음)
        this.map.closePopup();

        let attempts = 0;
        const maxAttempts = 30; // 최대 시도 횟수
        const retryInterval = 100; // 100ms 간격으로 재시도

        const checkAndOpen = () => {
            // 마커의 _icon이 DOM에 추가되었고, 맵에 속해 있는지 확인
            if (targetMarker._icon && targetMarker._map) {
                console.log(`Poll success for ${targetMarker.options.itemData.Yard} (Attempt ${attempts + 1}). Opening popup.`);
                targetMarker.openPopup(); // 마커에 직접 openPopup 호출 시도

                // 팝업이 실제로 열렸는지 확인 (선택 필터링 시 안정성을 위함)
                if (!targetMarker.getPopup().isOpen()) {
                    console.warn(`Popup for ${targetMarker.options.itemData.Yard} did not confirm open after direct call. Final retry via map.`);
                    this.map.openPopup(targetMarker.getPopup());
                }
            } else if (attempts < maxAttempts) {
                console.log(`Polling for ${targetMarker.options.itemData.Yard} (Attempt ${attempts + 1}): Marker not ready. Retrying...`);
                attempts++;
                setTimeout(checkAndOpen, retryInterval);
            } else {
                console.error(`Failed to open popup for ${targetMarker.options.itemData.Yard} after max polling attempts.`);
            }
        };

        setTimeout(checkAndOpen, 50); // 약간의 지연 후 첫 시도
    }

    /**
     * 데이터를 불러와 처리하고 지도에 마커를 렌더링합니다.
     */
    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            // 데이터 정제 및 파싱
            let processedData = rawData.map(item => ({
                lat: item.lat, // 파이썬에서 이미 float로 변환하여 제공
                lng: item.lng, // 파이썬에서 이미 float로 변환하여 제공
                Yard: item.location, // 파이썬에서 'location'으로 표준화됨
                location: item.location, // 파이썬에서 'location'으로 표준화됨 (Yard와 동일하게 유지)
                company: item.company,
                dwell_time: item.dwell_time, // 'congestion_score' 대신 'dwell_time'으로 변경
                indicator: item.indicator, // 파이썬에서 이미 float로 변환하여 제공
                congestion_level: item.congestion_level, // 파이썬에서 'congestion_level'로 표준화됨 ('Category'에 해당)
                average_value: parseFloat(item.Average), // 'Average' 컬럼 추가 매핑 (이제 파이썬에서 제공)
                date: item.date
            })).filter(item =>
                // 파이썬에서 이미 유효성 검사를 수행했지만, JS에서도 한 번 더 확인하는 것은 나쁘지 않습니다.
                // 다만, 파이썬이 더 엄격하게 필터링하므로, 여기서는 주요 값들만 확인합니다.
                item.lat !== undefined && item.lng !== undefined && item.location && item.congestion_level
            );

            const coordinateMap = new Map();

            // 중복 좌표 처리: 같은 위치에 여러 데이터가 있을 경우 지도에 겹쳐 표시되지 않도록 약간의 지터링 적용
            processedData.forEach(item => {
                const coordKey = `${item.lat},${item.lng}`;
                if (!coordinateMap.has(coordKey)) {
                    coordinateMap.set(coordKey, []);
                }
                coordinateMap.get(coordKey).push(item);
            });

            const jitteredData = [];
            coordinateMap.forEach(itemsAtCoord => {
                if (itemsAtCoord.length > 1) {
                    const baseLat = itemsAtCoord[0].lat;
                    const baseLng = itemsAtCoord[0].lng;

                    const offsetScale = 0.15; // 지터링 오프셋 스케일

                    itemsAtCoord.forEach((item, index) => {
                        const angle = (index / itemsAtCoord.length) * 2 * Math.PI;
                        // Jittering을 위도, 경도 모두에 적용하여 원 형태로 분산
                        const jitterLat = baseLat + (Math.cos(angle) * offsetScale * Math.random());
                        const jitterLng = baseLng + (Math.sin(angle) * offsetScale * Math.random());

                        item.lat = jitterLat;
                        item.lng = jitterLng;
                        jitteredData.push(item);
                    });
                } else {
                    jitteredData.push(itemsAtCoord[0]);
                }
            });

            this.currentData = jitteredData;

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].date;
            }

            this.renderMarkers(); // 마커 렌더링
            this.addRightControls(); // 우측 컨트롤(필터, 리셋) 추가
            this.addLastUpdatedText(); // 마지막 업데이트 텍스트 추가
            // this.addLegend(); // 주석 해제하여 범례 추가 가능

        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
        }
    }

    /**
     * 지도에 마커를 렌더링하거나 업데이트합니다.
     * @param {Array<Object>} [data=this.currentData] - 렌더링할 데이터 배열입니다.
     */
    renderMarkers(data = this.currentData) {
        if (!data || data.length === 0) {
            console.warn("No data provided to renderMarkers or data is empty. Clearing map layers.");
            this.allMarkers.clearLayers();
            if (this.map.hasLayer(this.allMarkers)) {
                this.map.removeLayer(this.allMarkers);
            }
            return;
        }

        this.allMarkers.clearLayers(); // 기존 마커 모두 제거

        data.forEach(item => {
            const marker = this.createSingleMarker(item);
            this.allMarkers.addLayer(marker); // 클러스터 그룹에 마커 추가
        });

        if (!this.map.hasLayer(this.allMarkers)) {
            this.map.addLayer(this.allMarkers); // 클러스터 그룹을 지도에 추가
        }

        // 클러스터 클릭 이벤트 재정의 (줌인)
        this.allMarkers.off('clusterclick');
        this.allMarkers.on('clusterclick', (a) => {
            console.log("Cluster clicked, zooming to bounds.");
            a.layer.zoomToBounds();
        });

        // 클러스터 마우스오버/아웃 팝업 (이전 수정에서 제거됨)
        // 이 로직은 더 이상 사용되지 않습니다.
    }

    /**
     * 개별 마커를 생성합니다.
     * @param {Object} item - 마커를 생성할 데이터 객체입니다.
     * @returns {L.Marker} 생성된 Leaflet 마커 객체입니다.
     */
    createSingleMarker(item) {
        const level = item.congestion_level || 'Average';
        const color = this.getColor(level);
        const radius = this.getRadiusByIndicator(item.indicator);

        // 마커 아이콘 HTML 생성 (원형, 혼잡도에 따른 색상)
        const iconHtml = `
            <div style="
                background-color: ${color};
                width: ${radius * 2}px;
                height: ${radius * 2}px;
                border-radius: 50%;
                border: 1.5px solid white;
                box-shadow: 0 0 3px rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
            "></div>
        `;

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize: [radius * 2, radius * 2],
            iconAnchor: [radius, radius]
        });

        const marker = L.marker([item.lat, item.lng], {
            icon: customIcon,
            itemData: item // 원본 데이터를 마커 옵션에 저장
        });

        const popupOptions = {
            closeButton: true,
            autoClose: true, // IMPORTANT: 다른 팝업이 열리거나 맵 클릭시 자동으로 닫히도록 변경
            closeOnClick: true, // IMPORTANT: 맵 배경 클릭 시 자동으로 닫히도록 변경
            maxHeight: 300,
            maxWidth: 300,
            className: 'single-marker-popup' // 개별 마커 팝업 클래스 추가
        };

        // 개별 마커의 팝업을 해당 마커의 데이터로 바인딩합니다.
        marker.bindPopup(this.createPopupContent([item]), popupOptions);

        // 이전 논의에서 제거되었던 L.tooltip을 활성화합니다.
        // 이것이 고객님께서 말씀하신 "호버 툴팁" 기능입니다.
        if (!L.Browser.mobile) { // 모바일에서는 툴팁을 사용하지 않습니다.
            marker.bindTooltip(`Yard: ${item.Yard}<br>Level: ${item.congestion_level}`, {
                permanent: false,
                direction: 'top',
                offset: L.point(0, -radius),
                className: 'custom-marker-tooltip'
            });
        }


        // 팝업 열릴 때 z-index 조정 및 클릭/스크롤 전파 방지
        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.Yard} just opened.`);
            e.popup.getElement().style.zIndex = 10000;
            const popupDiv = e.popup.getElement();
            if (popupDiv) {
                L.DomEvent.disableClickPropagation(popupDiv);
                L.DomEvent.disableScrollPropagation(popupDiv);
            }
            this.lastOpenedMarker = e.target; // 현재 열린 마커를 저장
        });

        // 팝업 닫힐 때 lastOpenedMarker 초기화
        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.Yard} just closed.`);
            if (this.lastOpenedMarker === e.target) {
                this.lastOpenedMarker = null; // 닫힌 팝업의 마커를 lastOpenedMarker에서 제거
            }
        });

        // 마커 클릭 시 동작 정의
        marker.on('click', (e) => {
            console.log(`Clicked/Tapped marker: ${item.Yard}. Current popup state: ${marker.getPopup().isOpen()}`);

            this.map.closePopup(); // 다른 팝업 먼저 닫기 (항상 새로운 팝업을 열기 전에 기존 팝업을 닫음)

            // `zoomToShowLayer`는 마커가 클러스터에 숨어있을 때 유용합니다.
            if (this.allMarkers.hasLayer(marker)) { // 마커가 클러스터 그룹에 속해 있다면 (클러스터링될 수 있다면)
                this.allMarkers.zoomToShowLayer(marker, () => {
                    // zoomToShowLayer 완료 후 팝업 열기
                    marker.openPopup();
                    console.log(`Popup for ${item.Yard} opened after zoomToShowLayer.`);
                    // if (!marker.getPopup().isOpen()) { // autoClose:true로 인해 이중 체크 불필요
                    //     console.warn(`Popup for ${yardName} did not confirm open after direct call. Final retry via map.`);
                    //     this.map.openPopup(foundMarker.getPopup());
                    // }
                });
            } else {
                // 마커가 클러스터링되지 않은 상태라면 바로 팝업 열기
                marker.openPopup();
                console.log(`Popup for ${item.Yard} opened directly.`);
                // if (!marker.getPopup().isOpen()) { // autoClose:true로 인해 이중 체크 불필요
                //     console.warn("Popup did not confirm open after direct call (not in cluster). Trying map.openPopup.");
                //     this.map.openPopup(marker.getPopup());
                // }
            }
        });

        return marker;
    }

    /**
     * 팝업 내용을 생성합니다 (개별 마커 또는 클러스터 해제 시).
     * @param {Array<Object>} items - 팝업에 표시할 데이터 항목 배열입니다.
     * @returns {string} 팝업에 들어갈 HTML 문자열입니다.
     */
    createPopupContent(items) {
        const safeItems = Array.isArray(items) ? items : [items];
        let content = '';

        if (safeItems.length === 0) {
            return '<p>No valid data to display for this location.</p>';
        }

        const isMultiple = safeItems.length > 1;

        if (isMultiple) {
            content += `<div class="cluster-popup-header">
                                <h4>${safeItems.length} Locations</h4>
                                <p>Showing individual details:</p>
                               </div>
                               <div class="cluster-popup-content">`;
        }

        safeItems.forEach(item => {
            if (!item || typeof item !== 'object' || typeof item.lat === 'undefined' || typeof item.lng === 'undefined') {
                console.warn("Skipping invalid or incomplete item in popup content:", item);
                return;
            }

            const level = item.congestion_level || 'Unknown';
            const company = item.company || 'Unknown';
            const location = item.location || 'Unknown Location';
            const dwellTime = (typeof item.dwell_time === 'number' && !isNaN(item.dwell_time)) ? item.dwell_time.toFixed(1) : 'N/A'; // 'dwell_time' 사용
            const averageValue = (typeof item.average_value === 'number' && !isNaN(item.average_value)) ? item.average_value.toFixed(1) : 'N/A';


            content += `
                <div class="location-info">
                    <h5>${location}</h5>
                    <p><strong>Company:</strong> ${company}</p>
                    <p><strong>Congestion Level:</strong>
                        <span style="color: ${this.getColor(level, true)}">
                            ${level}
                        </span>
                    </p>
                    <p><strong>Dwell Time:</strong> ${dwellTime} hours</p>
                    <p><strong>Average:</strong> ${averageValue} hours</p>
                </div>
                ${isMultiple && safeItems.indexOf(item) !== safeItems.length - 1 ? '<hr>' : ''}
            `;
        });

        if (isMultiple) {
            content += '</div>';
        }

        return content || '<p>No valid data to display for this location.</p>';
    }

    /**
     * 지도에 마지막 업데이트 시간을 표시하는 컨트롤을 추가합니다.
     */
    addLastUpdatedText() {
        if (this.lastUpdatedControl) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        if (this.lastUpdated) {
            const date = new Date(this.lastUpdated);
            // 날짜만 표시되도록 toLocaleString 옵션 변경
            const formattedDate = date.toLocaleString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            const infoControl = L.control({ position: 'bottomright' });

            infoControl.onAdd = () => {
                const div = L.DomUtil.create('div', 'last-updated-info');
                div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
                return div;
            };

            infoControl.addTo(this.map);
            this.lastUpdatedControl = infoControl;
        }
    }

    /**
     * 지도 우측 상단에 필터 드롭다운과 리셋 버튼 컨트롤을 추가합니다.
     */
    addRightControls() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            const validYards = this.currentData
                .filter(item => item.Yard && item.Yard.trim() !== '')
                .map(item => item.Yard);

            const yards = [...new Set(validYards)].sort((a, b) => a.localeCompare(b));

            const filterDropdownHtml = `
                <select class="yard-filter">
                    <option value="" disabled selected hidden>Select Yard</option>
                    <option value="All">All Yards</option>
                    ${yards.map(yard =>
                        `<option value="${yard}">${yard}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            const resetButtonHtml = `
                <button class="rail-reset-btn reset-btn">Reset View</button>
            `;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

            div.querySelector('.yard-filter').addEventListener('change', (e) => {
                const yardName = e.target.value;
                if (yardName === "All") {
                    console.log("Filter: All Yards selected. Resetting view.");
                    this.map.setView([37.8, -96], 4);
                    this.map.closePopup();
                    this.markerToOpenAfterMove = null;
                } else if (yardName) {
                    console.log(`Filter selected: ${yardName}`);
                    const yardDataForFilter = this.currentData.filter(item => item.Yard === yardName);
                    if (yardDataForFilter.length > 0) {
                        let foundMarker = null;
                        this.allMarkers.eachLayer(layer => {
                            if (layer.options.itemData && layer.options.itemData.Yard === yardName) {
                                foundMarker = layer;
                                return;
                            }
                        });

                        if (foundMarker) {
                            console.log(`Found marker for filter: ${yardName}. Using zoomToShowLayer.`);
                            this.map.closePopup(); // 다른 팝업 먼저 닫기
                            this.allMarkers.zoomToShowLayer(foundMarker, () => {
                                // zoomToShowLayer 완료 후 팝업 열기
                                foundMarker.openPopup();
                                console.log(`Popup for ${yardName} opened after zoomToShowLayer.`);
                                // if (!foundMarker.getPopup().isOpen()) { // autoClose:true로 인해 이중 체크 불필요
                                //     console.warn(`Popup for ${yardName} did not confirm open after direct call. Final retry via map.`);
                                //     this.map.openPopup(foundMarker.getPopup());
                                // }
                            });
                            this.markerToOpenAfterMove = null; // 성공적으로 처리했으므로 초기화
                        } else {
                            console.warn(`Marker object for yard '${yardName}' not immediately found. Falling back to fitBounds and polling.`);
                            const bounds = L.latLngBounds(yardDataForFilter.map(item => [item.lat, item.lng]));
                            this.map.fitBounds(bounds.pad(0.5), { maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1 });
                            this.markerToOpenAfterMove = yardName; // moveend 후 열기 위해 야드 이름 저장
                        }
                    } else {
                        console.warn(`No data found for yard '${yardName}'.`);
                    }
                }
            });

            div.querySelector('.rail-reset-btn').addEventListener('click', () => {
                console.log("Reset button clicked.");
                this.map.setView([37.8, -96], 4);
                this.map.closePopup();
                this.markerToOpenAfterMove = null;
                const yardFilter = div.querySelector('.yard-filter');
                if (yardFilter) {
                    yardFilter.value = '';
                    yardFilter.selectedIndex = 0;
                }
            });

            // 클릭/스크롤 전파 방지 (지도와 독립적으로 컨트롤 상호작용 가능하도록)
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };

        control.addTo(this.map);
    }

    /**
     * 지도에 혼잡도 레벨 범례를 추가합니다. (현재 주석 처리됨)
     */
    addLegend() {
        const legend = L.control({ position: 'bottomright' });

        legend.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'info legend');
            const levels = ['Very High', 'High', 'Average', 'Low', 'Very Low']; // Average 순서 조정
            const labels = [];

            for (let i = 0; i < levels.length; i++) {
                const level = levels[i];
                const color = this.getColor(level);

                labels.push(
                    `<i style="background:${color}"></i> ${level}`
                );
            }

            div.innerHTML = '<h4>Congestion Level</h4>' + labels.join('<br>');
            return div;
        }.bind(this); // 'this' 바인딩 필수

        legend.addTo(this.map);
    }

    /**
     * 야드 데이터의 중심 좌표를 계산합니다.
     * @param {Array<Object>} yardData - 야드 데이터 배열입니다.
     * @returns {Array<number>} [위도, 경도] 형태의 중심 좌표입니다.
     */
    getYardCenter(yardData) {
        if (!yardData || yardData.length === 0) return [37.8, -96];

        const lats = yardData.map(item => item.lat);
        const lngs = yardData.map(item => item.lng);

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        return [
            (minLat + maxLat) / 2,
            (minLng + maxLng) / 2
        ];
    }

    /**
     * 인디케이터 값에 따라 마커의 반경을 결정합니다.
     * @param {number} indicator - 인디케이터 값입니다.
     * @returns {number} 마커의 반경 (픽셀)입니다.
     */
    getRadiusByIndicator(indicator) {
        if (indicator > 2) return 20;
        if (indicator > 1) return 16;
        if (indicator > -1) return 12;
        if (indicator > -2) return 8;
        return 5;
    }

    /**
     * 혼잡도 레벨에 따른 색상을 반환합니다.
     * @param {string} level - 혼잡도 레벨 문자열입니다.
     * @param {boolean} [isText=false] - 텍스트 색상을 반환할지 여부입니다.
     * @returns {string} CSS 색상 코드입니다.
     */
    getColor(level, isText = false) {
        // 기존 색상에서 'Very Low'는 진한 파랑, 'Low'는 파랑, 'Average'는 회색, 'High'는 주황, 'Very High'는 빨강
        // 이전에 드렸던 제안의 색상 (Very Low: #42A5F5, Low: #90CAF9, Average: #9E9E9E, High: #FFB300, Very High: #E53935)
        // 위 색상들이 "매우낮음은 파랑 낮음은 연파랑 에버리지는 회색, 하이는 주황 베리하이는 빨강"에 부합하므로 이 색상으로 변경합니다.
        const circleColors = {
            'Very High': '#E53935',  // 빨강
            'High': '#FFB300',     // 주황
            'Average': '#9E9E9E',   // 회색
            'Low': '#90CAF9',      // 연파랑
            'Very Low': '#42A5F5', // 파랑
            'Unknown': '#bcbcbc'   // 알 수 없음 (기존 회색 유지)
        };

        // 텍스트 색상도 위 색상에 맞게 조정 (대비가 잘 되도록)
        const textColors = {
            'Very High': '#b71c1c', // 기존보다 진한 빨강 계열
            'High': '#e65100',      // 기존보다 진한 주황 계열
            'Average': '#616161',   // 기존보다 진한 회색 계열
            'Low': '#2196F3',       // 기존보다 진한 파랑 계열
            'Very Low': '#1976D2',  // 기존보다 진한 파랑 계열
            'Unknown': '#5e5e5e'    // 기존 회색 유지
        };

        return isText ? textColors[level] : circleColors[level];
    }

    /**
     * 지도에 에러 메시지를 일시적으로 표시합니다.
     * @param {string} message - 표시할 에러 메시지입니다.
     */
    displayErrorMessage(message) {
        if (this.errorControl) {
            this.map.removeControl(this.errorControl);
        }

        const errorControl = L.control({ position: 'topleft' });
        errorControl.onAdd = function() {
            const div = L.DomUtil.create('div', 'error-message');
            div.innerHTML = message;
            return div;
        };
        errorControl.addTo(this.map);
        this.errorControl = errorControl;

        // 5초 후 메시지 자동 제거
        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }
}

// RailCongestionMap 클래스를 전역 스코프에 노출합니다.
window.RailCongestionMap = RailCongestionMap;
