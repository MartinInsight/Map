import requests

def download_data():
    url = "https://example.com/data.csv"  # 실제 데이터 URL로 변경 필요
    response = requests.get(url)
    with open("data/data.csv", "wb") as f:
        f.write(response.content)

if __name__ == "__main__":
    download_data()
