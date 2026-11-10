import scrapy
class T(scrapy.Spider):
    name = 't'
    start_urls = ['https://tw.1688.com/pic/-c3a8d6b8bcd7bcf4.html']
    def parse(self, response):
        links = response.css("a[href*='/offer/']").getall()
        print('SCRAPY_RESULT title=%r links=%d status=%s' % (response.css('title::text').get(), len(links), response.status))