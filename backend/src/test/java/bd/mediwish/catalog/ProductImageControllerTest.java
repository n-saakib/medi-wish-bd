package bd.mediwish.catalog;
import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRole;
import bd.mediwish.web.WebTestFixtures;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.mock.web.MockMultipartFile;
import java.time.Instant;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class ProductImageControllerTest {
    private static final UUID ID = UUID.fromString("8a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b");
    private final ProductImageService service = mock(ProductImageService.class);
    private final org.springframework.test.web.servlet.MockMvc mvc = WebTestFixtures.catalogMvc(new ProductImageController(service));
    private final String path = "/api/staff/products/" + ID;
    @Test void mappingsUseStrictRequestsAndReturnCreatedReplayAndDeleteStatuses() throws Exception {
        var actor = new CurrentUser(UUID.randomUUID(), UUID.randomUUID(), new UserProfile("synthetic", "01700000000", null, false),
                Set.of(UserRole.ADMIN), MfaStatus.VERIFIED, Set.of("ROLE_ADMIN"));
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(actor, null, List.of()));
        try {
            var view = new ProductImageViews.ImageView(ID, "/api/public/product-images/" + ID + ".png", "image/png", 1,1,3,null,0,0,Instant.EPOCH);
            when(service.upload(eq(ID),eq(ID),any(byte[].class),eq("image/png"),eq("front.png"),isNull(),isNull(),eq(actor)))
                    .thenReturn(new ProductImageViews.ImageCreation(view,true), new ProductImageViews.ImageCreation(view,false));
            for (int expected : new int[]{201,200}) mvc.perform(multipart(path + "/images")
                    .file(new MockMultipartFile("file","front.png","image/png",new byte[]{1,2,3})).part(new org.springframework.mock.web.MockPart("id", ID.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8))))
                    .andExpect(status().is(expected)).andExpect(jsonPath("$.id").value(ID.toString()));
            when(service.list(ID,actor)).thenReturn(new ProductImageViews.ImageList(List.of(view),8));
            mvc.perform(get(path + "/images")).andExpect(status().isOk()).andExpect(jsonPath("$.maxImages").value(8));
            when(service.updateAltText(ID,ID,"front",0L,actor)).thenReturn(view);
            mvc.perform(put(path + "/images/" + ID).contentType("application/json").content("{\"altText\":\"front\",\"version\":0}"))
                    .andExpect(status().isOk());
            when(service.reorder(ID,List.of(ID),List.of(ID),actor)).thenReturn(new ProductImageViews.ImageList(List.of(view),8));
            mvc.perform(put(path + "/image-order").contentType("application/json")
                    .content("{\"imageIds\":[\""+ID+"\"],\"expectedImageIds\":[\""+ID+"\"]}")).andExpect(status().isOk());
            mvc.perform(delete(path + "/images/" + ID)).andExpect(status().isNoContent()); verify(service).remove(ID,ID,actor);
        } finally { SecurityContextHolder.clearContext(); }
    }
    @Test void nonMultipartUploadIs415WithoutServiceCall() throws Exception {
        mvc.perform(post(path + "/images").contentType("application/json").content("{}"))
                .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(service);
    }
}
