-- Fixed-price listings have no auction clock, winning bidder or payment record.
alter type public.auction_status_t add value if not exists 'LISTED';
alter type public.auction_status_t add value if not exists 'SOLD_DIRECT';
